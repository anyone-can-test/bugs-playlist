# Bugs playlist creator

Bugs Music 플레이리스트를 만들고 MBC 라디오 프로그램의 공식 선곡표를 날짜별 또는 기간별로 가져오는 Node.js + Playwright 도구입니다. 기본 프로그램은 배철수의 음악캠프이며, MBC 프로그램 코드와 이름을 바꾸면 다른 MBC 라디오 프로그램도 수집할 수 있습니다.

## 준비

- Node.js 20 이상
- Bugs 계정

```sh
npm install
npx playwright install chromium
```

## 빠른 미리보기

예제 설정으로 실행합니다. MBC 선곡표를 조회하고 결과를 표시하지만 Bugs 플레이리스트에는 저장하지 않습니다.

```sh
npm run preview
```

미리보기는 MBC 조회를 위해 Chromium 창을 엽니다. 실제 플레이리스트를 만들려면 아래의 로그인 및 실행 방법을 사용하세요.

## Bugs 로그인

처음 실제 실행하면 Chromium 창이 열립니다. Bugs에 직접 로그인하면 작업을 이어갑니다. 브라우저 프로필은 프로젝트 폴더의 `.bugs-profile/`에 저장되어 다음 실행에 재사용됩니다. 이 폴더는 Git에서 제외됩니다.

## 프로그램과 방송일 지정

프로그램 코드는 MBC 공식 선곡표 페이지 URL의 `progCode` 값입니다. 프로그램 이름은 날짜별 플레이리스트 제목에 사용됩니다.

```sh
npm start -- --program-code RAMFM300 --program-name "배철수 음악캠프" --date 2026-11-22 --dry-run
```

다른 MBC 라디오 프로그램은 해당 프로그램의 선곡표에서 `progCode`를 확인해 바꿉니다.

```sh
npm start -- --program-code FM4U000001000 --program-name "프로그램명" --date 2026-11-22 --dry-run
```

하루별 플레이리스트를 실제로 생성하려면 `--dry-run`을 빼세요. 날짜별 플레이리스트 이름은 `프로그램명 YYYY-MM-DD` 형식입니다.

날짜 범위의 방송을 각각 별도 플레이리스트로 만듭니다.

```sh
npm start -- --from 2026-11-20 --to 2026-11-22 --dry-run
```

기간 내 선곡을 하나의 플레이리스트에 모으려면 제목을 지정합니다.

```sh
npm start -- --from 2026-11-20 --to 2026-11-22 --playlist-title "배캠 11월 모음" --dry-run
```

기간 옵션은 최대 31일입니다. 같은 이름의 플레이리스트가 이미 있으면 중복 생성을 피하기 위해 건너뜁니다.

## 설정 파일로 실행

`bugs-playlist.config.example.json`을 복사해 `bugs-playlist.config.json`으로 저장하고 프로그램 코드, 프로그램 이름, 날짜 또는 기간, 플레이리스트 제목을 수정합니다.

Windows PowerShell:

```powershell
Copy-Item bugs-playlist.config.example.json bugs-playlist.config.json
```

macOS 또는 Linux:

```sh
cp bugs-playlist.config.example.json bugs-playlist.config.json
```

저장한 설정으로 미리보기:

```sh
npm start -- --config bugs-playlist.config.json
```

설정 파일 실행은 기본적으로 미리보기입니다. 실제 Bugs 계정에 반영하려면 명시적으로 실행합니다.

```sh
npm start -- --config bugs-playlist.config.json --execute
```

또는 설정 JSON에 `"dryRun": false`를 지정할 수 있습니다. 날짜별 실행에는 `date`, 기간 실행에는 `from`과 `to`를 사용합니다. 하나의 기간 플레이리스트를 만들 때는 `playlistTitle`을 추가합니다. 설정 파일에는 개인용 복사본을 사용하고, 로그인 정보는 저장하지 마세요.

## 빈 플레이리스트만 만들기

기존처럼 제목만 전달해 빈 플레이리스트를 만들 수도 있습니다.

```sh
npm start -- "출근길 음악"
```

실제 저장 없이 생성 화면만 확인하려면:

```sh
npm start -- "출근길 음악" --dry-run
```

Bugs에서 일치하는 곡을 찾지 못하면 건너뛰고 결과에 표시합니다. 같은 곡의 버전이 여러 개면 검색 결과 중 제목과 아티스트가 일치하는 첫 번째 곡을 선택합니다. 곡 순서는 Bugs의 ‘내 앨범에 곡 담기 위치’ 설정을 따릅니다. MBC 선곡표의 개인적 사용은 해당 페이지의 이용 조건을 확인하세요.

## 파일

- `bugs-playlist.mjs` — MBC 선곡 수집, Bugs 검색 및 플레이리스트 생성
- `bugs-playlist.config.example.json` — 재사용 가능한 설정 예제
- `package.json` — 실행 명령과 Playwright 의존성
- `.gitignore` — 로그인 세션과 로컬 설정 파일 제외
