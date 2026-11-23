/**
 * Node.js + Playwright: Bugs 빈 플레이리스트(내 앨범) 생성.
 * 설치: npm install && npx playwright install chromium
 * 실행: npm start -- "출근길 음악"
 * 점검: npm start -- "출근길 음악" --dry-run
 * 최초 실행 시 열린 브라우저에서 직접 로그인하세요(최대 5분).
 * 전용 .bugs-profile에 세션을 보관합니다. Git/공유 대상에서 제외하세요.
 * 곡 추가는 이 스크립트의 범위에 포함되지 않습니다.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://music.bugs.co.kr/user/library/myalbum/list';

export async function createPlaylist(page, title, { dryRun = false } = {}) {
  title = title?.trim();
  if (!title || title.length > 100) {
    throw new Error('제목은 공백을 제외하고 1~100자여야 합니다.');
  }
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const create = page.getByRole('link', { name: '새로 만들기', exact: true });
  console.log('로그인이 필요하면 열린 브라우저에서 로그인해 주세요.');
  await create.waitFor({ state: 'visible', timeout: 300_000 });
  const list = page.locator('#myAlbumListAjax');
  await list.waitFor({ state: 'visible' });
  // 현재 페이지의 기존 URL을 기록하여 동일 제목의 이전 앨범을 성공으로 오인하지 않습니다.
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

  // 저장은 단 한 번 실행합니다. 타임아웃 후 자동 재시도하면 중복 생성될 수 있습니다.
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
    const href = urls.find(href => !before.has(href)
      && /\/user\/library\/myalbum\/\d+/.test(href || ''));
    if (!href) throw new Error('생성된 앨범 링크를 찾지 못했습니다.');
    return { status: 'created', title, url: new globalThis.URL(href, URL).href };
  } catch (error) {
    throw new Error('저장 후 생성 여부를 확인하지 못했습니다. 재실행 전에 내 앨범 목록을 확인하세요.', { cause: error });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const titles = args.filter(arg => arg !== '--dry-run');
  if (titles.length !== 1 || !titles[0].trim() || titles[0].trim().length > 100) {
    throw new Error('사용법: node bugs-playlist.mjs "플레이리스트 제목(1~100자)" [--dry-run]');
  }
  const profile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.bugs-profile');
  const context = await chromium.launchPersistentContext(profile, { headless: false });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(15_000);
    // 성공 알림은 닫고, 확인/입력 대화상자는 자동 승인하지 않습니다.
    page.on('dialog', async dialog => {
      console.log('[' + dialog.type() + '] ' + dialog.message());
      if (dialog.type() === 'alert') await dialog.accept();
      else await dialog.dismiss();
    });
    console.log(await createPlaylist(page, titles[0], { dryRun }));
  } finally {
    await context.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
