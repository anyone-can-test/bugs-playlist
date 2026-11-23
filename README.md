# Bugs playlist creator

Bugs Music의 **내 앨범** 페이지에서 새 플레이리스트(빈 앨범)를 만드는 Node.js + Playwright 예제입니다.

## 준비

- Node.js 20 이상
- Bugs 계정과 로그인 가능한 브라우저 세션

~~~sh
npm install
npx playwright install chromium
~~~

## 실행

~~~sh
npm start -- "출근길 음악"
~~~

처음 실행하면 Chromium 창이 열립니다. Bugs에 로그인하면 스크립트가 플레이리스트 생성 화면으로 진행합니다. 브라우저 프로필은 프로젝트 폴더의 .bugs-profile/에 저장되어 다음 실행에 재사용됩니다. 이 폴더는 .gitignore에 포함되어 있습니다.

실제 저장 없이 입력 화면만 열고 취소하려면 다음을 실행합니다.

~~~sh
npm start -- "출근길 음악" --dry-run
~~~

생성에 성공하면 제목과 플레이리스트 URL을 출력합니다. 저장 후 결과를 확인하지 못한 경우 중복 생성을 막기 위해 자동 재시도하지 않습니다. 먼저 Bugs의 내 앨범 목록을 직접 확인하세요.

현재 코드는 **빈 플레이리스트 생성**까지만 처리하며, 곡 검색이나 플레이리스트에 곡을 추가하지 않습니다. Bugs 웹사이트의 UI나 선택자가 변경되면 코드 수정이 필요할 수 있습니다.

## 파일

- bugs-playlist.mjs — 생성 동작 및 CLI
- .gitignore — 로그인 세션과 로컬 산출물 제외
- package.json — 실행 명령과 Playwright 의존성
