/**
 * Node.js + Playwright: Bugs 내 앨범 생성 및 MBC 라디오 프로그램별 선곡 담기.
 *
 * 설치: npm install && npx playwright install chromium
 * 빈 앨범: npm start -- "출근길 음악"
 * 한 날짜 선곡: npm start -- --date 2026-11-22
 * 날짜별 목록: npm start -- --from 2026-11-20 --to 2026-11-22
 * 기간 단일 목록: npm start -- --from 2026-11-20 --to 2026-11-22 --playlist-title "배캠 모음"
 * 미리보기: npm run preview
 * 설정 파일: npm start -- --config bugs-playlist.config.json
 *
 * 최초 실행 시 열린 브라우저에서 직접 Bugs에 로그인하세요(최대 5분).
 * 전용 .bugs-profile에 세션을 보관합니다. Git/공유 대상에서 제외하세요.
 * MBC 선곡과 일치하는 Bugs 곡을 찾지 못하면 건너뛰고 결과에 표시합니다.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUGS_LIBRARY_URL = 'https://music.bugs.co.kr/user/library/myalbum/list';
const BUGS_SEARCH_URL = 'https://music.bugs.co.kr/search/integrated';
const MBC_INDEX_URL = 'https://miniweb.imbc.com/Music/Index';
const MBC_BASE_URL = 'https://miniweb.imbc.com';
const DEFAULT_PROGRAM = { code: 'RAMFM300', name: '배철수 음악캠프' };

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeArtist(value) {
  return normalize(String(value ?? '')
    .replace(/^\s*ost\s*[/|-]\s*/i, '')
    .replace(/\b(feat(?:uring)?\.?|ft\.?|with)\b.*$/i, ''));
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
    throw new Error('날짜 형식은 YYYY-MM-DD여야 합니다.');
  }
  const date = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('존재하지 않는 날짜입니다: ' + value);
  }
  return value;
}

function dateRange(from, to) {
  const start = Date.parse(validateDate(from) + 'T00:00:00Z');
  const end = Date.parse(validateDate(to) + 'T00:00:00Z');
  if (end < start) throw new Error('--to는 --from보다 빠를 수 없습니다.');
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (days > 31) throw new Error('한 번에 처리할 수 있는 범위는 최대 31일입니다.');
  return Array.from({ length: days }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

async function fetchBroadcasts(page, from, to, programCode) {
  const indexByDate = new Map();
  const pagesToScan = 365;
  for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber += 1) {
    const indexUrl = MBC_INDEX_URL + '?page=' + pageNumber
      + '&progCode=' + programCode;
    await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
    const entries = await page.locator('table tr').evaluateAll(rows =>
      rows.slice(1).map(row => {
        const cells = [...row.querySelectorAll('td')];
        return {
          date: cells[0]?.innerText.trim() ?? '',
          href: cells[1]?.querySelector('a')?.getAttribute('href') ?? '',
        };
      }).filter(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.href),
    );
    if (entries.length === 0) break;
    for (const entry of entries) {
      if (entry.date >= from && entry.date <= to) {
        indexByDate.set(entry.date, new URL(entry.href, MBC_BASE_URL).href);
      }
    }
    const oldestDate = entries.reduce((oldest, item) =>
      item.date < oldest ? item.date : oldest, entries[0].date);
    if (oldestDate < from) break;
  }

  const broadcasts = [];
  for (const date of [...indexByDate.keys()].sort()) {
    await page.goto(indexByDate.get(date), { waitUntil: 'domcontentloaded' });
    const tracks = await page.locator('table tr').evaluateAll(rows =>
      rows.slice(1).map(row => [...row.querySelectorAll('td')].map(cell =>
        cell.innerText.trim()))
        .filter(cells => cells.length >= 3 && cells[1] && cells[2])
        .map(cells => ({ title: cells[1], artist: cells[2] })),
    );
    if (tracks.length > 0) broadcasts.push({ date, tracks });
  }
  return broadcasts;
}

export async function createPlaylist(page, title, { dryRun = false } = {}) {
  title = title?.trim();
  if (!title || title.length > 100) {
    throw new Error('제목은 공백을 제외하고 1~100자여야 합니다.');
  }
  await page.goto(BUGS_LIBRARY_URL, { waitUntil: 'domcontentloaded' });
  const create = page.getByRole('link', { name: '새로 만들기', exact: true });
  console.log('로그인이 필요하면 열린 브라우저에서 로그인해 주세요.');
  await create.waitFor({ state: 'visible', timeout: 300_000 });

  const list = page.locator('#myAlbumListAjax');
  await list.waitFor({ state: 'visible' });
  const existing = list.getByRole('link', { name: title, exact: true });
  if (await existing.count()) {
    const href = await existing.first().getAttribute('href');
    return { status: 'exists', title, url: href ? new URL(href, BUGS_LIBRARY_URL).href : null };
  }
  const before = new Set(await list.getByRole('link').evaluateAll(
    links => links.map(link => link.getAttribute('href')),
  ));
  await create.click();
  const form = page.locator('#createMyAlbumLayer');
  await form.waitFor({ state: 'visible' });
  await form.locator('#createMyAlbumLayerTitle').fill(title);
  if (dryRun) {
    await form.locator('#createMyAlbumLayerCancel').click();
    await form.waitFor({ state: 'hidden' });
    return { status: 'dry-run', title };
  }

  // 저장은 한 번만 합니다. 타임아웃 후 자동 재시도하면 중복 생성될 수 있습니다.
  await form.locator('#createMyAlbumLayerUpdate').click();
  try {
    await form.waitFor({ state: 'hidden', timeout: 15_000 });
    await page.waitForFunction(({ title, before }) => {
      const links = document.querySelectorAll('#myAlbumListAjax a');
      return [...links].some(a => a.textContent.trim() === title
        && /\/user\/library\/myalbum\/\d+/.test(a.getAttribute('href') || '')
        && !before.includes(a.getAttribute('href')));
    }, { title, before: [...before] }, { timeout: 15_000 });
    const urls = await list.getByRole('link', { name: title, exact: true })
      .evaluateAll(links => links.map(a => a.getAttribute('href')));
    const href = urls.find(item => !before.has(item)
      && /\/user\/library\/myalbum\/\d+/.test(item || ''));
    if (!href) throw new Error('생성된 앨범 링크를 찾지 못했습니다.');
    return { status: 'created', title, url: new URL(href, BUGS_LIBRARY_URL).href };
  } catch (error) {
    throw new Error('저장 후 생성 여부를 확인하지 못했습니다. 재실행 전에 내 앨범 목록을 확인하세요.', { cause: error });
  }
}

async function findBugsTrack(page, song) {
  const artist = normalizeArtist(song.artist);
  const query = [song.title, song.artist.replace(/^\s*ost\s*[/|-]\s*/i, '')]
    .filter(Boolean).join(' ');
  const url = new URL(BUGS_SEARCH_URL);
  url.searchParams.set('q', query);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  const rows = await page.locator('table tr').evaluateAll(elements =>
    elements.map((row, index) => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (!checkbox) return null;
      const label = checkbox.getAttribute('aria-label')
        || checkbox.getAttribute('title')
        || [...(checkbox.labels ?? [])].map(item => item.innerText.trim()).join(' ')
        || '';
      return { index, label, text: row.innerText.trim() };
    }).filter(Boolean),
  );
  const titleKey = normalize(song.title);
  const candidates = rows.map(row => {
    const labelKey = normalize(row.label);
    const rowKey = normalize(row.text);
    const titleMatch = labelKey === titleKey ? 3
      : labelKey.includes(titleKey) || rowKey.includes(titleKey) ? 2 : 0;
    const artistMatch = !artist || rowKey.includes(artist) ? 2 : 0;
    return { ...row, score: titleMatch + artistMatch };
  }).filter(row => row.score >= 4);

  if (candidates.length === 0) {
    return { status: 'not-found', song };
  }
  // MBC는 녹음/리마스터 버전을 구분하지 않으므로 Bugs 상위 검색 결과를 우선합니다.
  const selected = candidates[0];
  const row = page.locator('table tr').nth(selected.index);
  await row.getByRole('link', { name: '내 앨범에 담기', exact: true }).click();
  const playlist = page.getByRole('link', { name: song.playlistTitle, exact: true });
  await playlist.waitFor({ state: 'visible', timeout: 10_000 });
  await playlist.click();
  return { status: 'added', song, alternatives: candidates.length };
}

async function addBroadcastTracks(page, broadcast, playlistTitle) {
  const results = [];
  for (const track of broadcast.tracks) {
    results.push(await findBugsTrack(page, { ...track, playlistTitle }));
  }
  return {
    added: results.filter(result => result.status === 'added').length,
    notFound: results.filter(result => result.status === 'not-found').map(result => result.song),
  };
}

async function createRangePlaylist(page, broadcasts, title, { dryRun = false } = {}) {
  const tracks = broadcasts.flatMap(broadcast =>
    broadcast.tracks.map(track => ({ ...track, date: broadcast.date })),
  );
  if (dryRun) {
    return {
      status: 'dry-run', title,
      from: broadcasts[0]?.date ?? null,
      to: broadcasts.at(-1)?.date ?? null,
      tracks: tracks.length,
    };
  }
  const playlist = await createPlaylist(page, title);
  if (playlist.status === 'exists') {
    return { status: 'skipped-existing', title, url: playlist.url };
  }
  const results = [];
  for (const track of tracks) {
    results.push({
      date: track.date,
      ...(await findBugsTrack(page, { ...track, playlistTitle: title })),
    });
  }
  return {
    status: 'created', title, url: playlist.url,
    from: broadcasts[0]?.date ?? null,
    to: broadcasts.at(-1)?.date ?? null,
    added: results.filter(result => result.status === 'added').length,
    total: tracks.length,
    notFound: results.filter(result => result.status === 'not-found')
      .map(result => ({ date: result.date, ...result.song })),
  };
}

async function createDailyPlaylists(page, broadcasts, programName, { dryRun = false } = {}) {
  const summary = [];
  for (const broadcast of broadcasts) {
    const title = programName + ' ' + broadcast.date;
    if (dryRun) {
      summary.push({ date: broadcast.date, title, tracks: broadcast.tracks.length, status: 'dry-run' });
      continue;
    }
    const playlist = await createPlaylist(page, title);
    if (playlist.status === 'exists') {
      summary.push({ date: broadcast.date, title, status: 'skipped-existing', url: playlist.url });
      continue;
    }
    const results = await addBroadcastTracks(page, broadcast, title);
    summary.push({
      date: broadcast.date,
      title,
      status: 'created',
      url: playlist.url,
      added: results.added,
      total: broadcast.tracks.length,
      notFound: results.notFound,
    });
  }
  return summary;
}

function parseArgs(args) {
  const positional = [];
  const options = { configPath: null, dryRun: null, execute: false, date: null, from: null, to: null, playlistTitle: null, programCode: null, programName: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--execute') options.execute = true;
    else if (arg === '--config' || arg === '--date' || arg === '--from' || arg === '--to'
      || arg === '--playlist-title' || arg === '--program-code' || arg === '--program-name') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(arg + ' 다음에 값을 입력하세요.');
      if (arg === '--config') options.configPath = value;
      else if (arg === '--playlist-title') options.playlistTitle = value;
      else if (arg === '--program-code') options.programCode = value;
      else if (arg === '--program-name') options.programName = value;
      else options[arg.slice(2)] = value;
    } else if (arg.startsWith('--')) {
      throw new Error('알 수 없는 옵션: ' + arg);
    } else positional.push(arg);
  }
  return { positional, options };
}

async function loadRunOptions(cliOptions) {
  let config = {};
  if (cliOptions.configPath) {
    const configFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), cliOptions.configPath);
    try {
      config = JSON.parse(await readFile(configFile, 'utf8'));
    } catch (error) {
      throw new Error('설정 파일을 읽을 수 없습니다: ' + configFile, { cause: error });
    }
    if (!config || Array.isArray(config) || typeof config !== 'object') {
      throw new Error('설정 파일 최상위 값은 JSON 객체여야 합니다.');
    }
    const allowed = new Set(['programCode', 'programName', 'date', 'from', 'to', 'playlistTitle', 'dryRun']);
    const unknown = Object.keys(config).filter(key => !allowed.has(key));
    if (unknown.length) throw new Error('설정 파일에 알 수 없는 항목이 있습니다: ' + unknown.join(', '));
  }
  const options = {
    programCode: DEFAULT_PROGRAM.code,
    programName: DEFAULT_PROGRAM.name,
    dryRun: cliOptions.configPath ? true : false,
    ...config,
  };
  for (const key of ['date', 'from', 'to', 'playlistTitle', 'programCode', 'programName']) {
    if (cliOptions[key] !== null) options[key] = cliOptions[key];
  }
  if (cliOptions.dryRun !== null) options.dryRun = cliOptions.dryRun;
  if (cliOptions.execute) options.dryRun = false;
  if (typeof options.dryRun !== 'boolean') throw new Error('dryRun은 true 또는 false여야 합니다.');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(options.programCode)) {
    throw new Error('programCode는 영문자, 숫자, 밑줄, 하이픈으로 구성해야 합니다.');
  }
  if (typeof options.programName !== 'string' || !options.programName.trim() || options.programName.trim().length > 100) {
    throw new Error('programName은 1~100자여야 합니다.');
  }
  options.programName = options.programName.trim();
  return options;
}

async function main() {
  const { positional, options: cliOptions } = parseArgs(process.argv.slice(2));
  if (cliOptions.configPath && positional.length) {
    throw new Error('--config과 위치 인자 플레이리스트 제목은 함께 사용할 수 없습니다.');
  }
  const options = await loadRunOptions(cliOptions);
  const dateMode = options.date !== undefined || options.from !== undefined || options.to !== undefined;
  if (dateMode && positional.length) {
    throw new Error('날짜 옵션과 플레이리스트 제목은 함께 사용할 수 없습니다.');
  }
  if (!dateMode && !cliOptions.configPath && (positional.length !== 1 || !positional[0].trim()
    || positional[0].trim().length > 100)) {
    throw new Error('사용법: npm start -- "플레이리스트 제목" [--dry-run]');
  }
  if (options.date && (options.from || options.to)) {
    throw new Error('--date와 --from/--to는 함께 사용할 수 없습니다.');
  }
  if (options.playlistTitle && (!options.from || !options.to)) {
    throw new Error('--playlist-title은 --from과 --to 범위에서만 사용할 수 있습니다.');
  }
  if (dateMode && !options.date && (!options.from || !options.to)) {
    throw new Error('날짜 범위에는 --from과 --to가 모두 필요합니다.');
  }
  if (!dateMode && cliOptions.configPath) throw new Error('설정에 date 또는 from과 to를 입력하세요.');

  const profile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.bugs-profile');
  const context = await chromium.launchPersistentContext(profile, { headless: false });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(15_000);
    if (!dateMode) {
      console.log(await createPlaylist(page, positional[0], { dryRun: options.dryRun }));
      return;
    }
    page.on('dialog', async dialog => {
      console.log('[' + dialog.type() + '] ' + dialog.message());
      if (dialog.type() === 'alert') await dialog.accept();
      else await dialog.dismiss();
    });

    const dates = options.date ? [validateDate(options.date)] : dateRange(options.from, options.to);
    const broadcasts = await fetchBroadcasts(page, dates[0], dates[dates.length - 1], options.programCode);
    const byDate = new Map(broadcasts.map(item => [item.date, item]));
    for (const date of dates) {
      if (!byDate.has(date)) console.log({ date, status: 'no-broadcast-found' });
    }
    if (options.playlistTitle && broadcasts.length === 0) {
      throw new Error('기간 내 방송 선곡을 찾지 못했습니다.');
    }
    if (options.dryRun) {
      if (options.playlistTitle) {
        console.log(await createRangePlaylist(page, broadcasts, options.playlistTitle, { dryRun: true }));
      } else {
        console.log(await createDailyPlaylists(page, broadcasts, options.programName, { dryRun: true }));
      }
      return;
    }
    console.log('MBC 선곡표를 확인했습니다. Bugs 로그인이 필요하면 열린 브라우저에서 로그인해 주세요.');
    if (options.playlistTitle) console.log(await createRangePlaylist(page, broadcasts, options.playlistTitle));
    else console.log(await createDailyPlaylists(page, broadcasts, options.programName));
  } finally {
    await context.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
