# 웹죽 데스크 · WebJuk Desk

`https://crawl.nemelex.cards/`용 Chrome Manifest V3 확장입니다. 원본 WebTiles의 오른쪽 상태창·미니맵·몬스터 목록을 유지하고, 그 아래에 소지품·마법·투척물 타일 탭을 넣습니다. 별도 사이드바나 가로 공간을 만들지 않습니다.

## 설치

1. GitHub의 **Code → Download ZIP**으로 소스를 받은 뒤 압축을 풉니다. 이미 클론했다면 저장소의 `extension` 폴더를 사용합니다.
2. Chrome에서 `chrome://extensions`를 열고 **개발자 모드 → 압축해제된 확장 프로그램을 로드합니다**를 선택합니다.
3. `manifest.json`이 들어 있는 폴더를 선택하고 웹죽 탭을 새로고침합니다.

Chrome 111 이상이 필요합니다. Chrome Web Store에 게시된 확장이 아니므로 로컬 폴더로 설치합니다. ZIP을 그대로 선택하는 방식은 지원하지 않습니다.

## 조작

| 조작                        | 기능                              |
| --------------------------- | --------------------------------- |
| `Alt I` / `Alt M` / `Alt T` | 소지품 / 마법 / 투척물 탭         |
| 타일 좌클릭                 | 아이템 사용·투척 / 마법 시전      |
| 타일 우클릭                 | 원본 게임 설명 화면               |
| `Shift` + 타일 클릭 / `☆`   | 빠른 슬롯 등록·해제               |
| `Alt 1`–`Alt 6`             | 등록한 슬롯 사용                  |
| 빠른 슬롯 우클릭            | 슬롯 해제                         |
| `Alt` + 백틱                | 패널 접기·펼치기                  |
| 마법 탭 `↻`                 | 서버의 최신 마법 목록 조회        |
| `⚙` → 기술 `↻` / 능력 `↻`  | 서버의 기술 수치 / 능력 목록 조회 |

설명은 툴팁으로만 표시합니다. 패널은 원본 `#stats`의 실제 너비에 고정되며 내부에서 세로 스크롤합니다. 채팅·한글 조합·입력 필드에서는 확장 단축키를 가로채지 않습니다. 장비처럼 서버가 직접 사용 동작을 제공하지 않는 항목은 설명 화면에서 장착·해제를 이어갑니다.

## 몬스터 대응 정보

원본 몬스터 행 오른쪽에 위험도와 최대 두 개의 대응 아이콘을 붙입니다. 아이콘에 마우스를 올리면 이름·선정 근거가 나오고 클릭하면 원본 게임의 사용·시전 흐름으로 연결됩니다.

- 기본 위험도: 서버가 보내는 몬스터 위협 등급. 현재 HP, 시야 내 적 수, 행동을 제한하는 상태 이상, 치명적 중독으로 보정합니다.
- 대응 후보: 현재 소지품·충전량, MP, 마지막으로 확인한 마법 실패율·기술 수치·능력 목록을 사용합니다. 확인한 저항이 있으면 속성 약점·저항·면역을 반영합니다.
- 위험도는 **설명 가능한 규칙에 따른 추정**입니다. AC·EV·SH는 근거 툴팁에 표시하며, 명중률·예상 피해·승률을 계산하지 않습니다. 사거리, 시선, 신앙 비용, 몬스터의 변화한 장비·상태에 따른 사용 가능성은 원본 게임에서 최종 판단합니다.
- 몬스터의 기본 네트워크 데이터에는 속성 저항이 없습니다. 원본 몬스터 설명을 연 뒤 읽을 수 있는 `rF`, `rC`, `rPois`, `rNeg`, `rElec`, `rCorr` 표기만 캐시합니다. 알 수 없는 값은 미확인으로 유지합니다.
- 미식별 물약·두루마리를 회복·탈출용이라고 추측하지 않습니다. 우호·중립 몬스터에는 공격 후보를 표시하지 않습니다.

## 데이터 갱신 방식

소지품은 `player.inv` 변경 메시지를 따라 실시간으로 갱신합니다. 0.35 트렁크의 52번 이후 소모품 슬롯도 포함하며, 슬롯별 단축키는 서버 값을 사용합니다.

마법·능력·기술 전체 목록은 기본 `player` 메시지에 없습니다. 원본 메뉴를 조회해 얻은 값을 세션에 보관합니다. 갱신 버튼은 해당 메뉴를 열고 응답을 읽은 뒤 `Esc`로 닫습니다. 기술 조회는 훈련 선택 키를 보내지 않습니다. 마법·능력을 실행할 때는 서버 메뉴를 다시 열어 현재 단축키로 선택합니다. 시전·대상 지정을 자동으로 확정하지 않습니다. 목록의 수치와 저항·기술 정보는 마지막 조회 시점 기준입니다.

관전·연결 끊김·다른 메뉴·대상 지정 중에는 실행을 막습니다. 키보드 입력이 들어오면 대기 중인 자동 선택을 취소합니다. 재접속·새 게임 클라이언트 수신 시 목록 캐시를 비웁니다.

## 개발 및 검증

런타임 라이브러리와 빌드 과정이 없습니다. Node 20 이상에서:

```sh
npm test
npm run check
npm run package
npm run demo
```

데모는 `http://127.0.0.1:4173`에서 실행됩니다. 테스트 캐릭터와 결정적인 WebTiles 메시지 fixture를 사용하며 실제 서버 계정이나 턴에 접근하지 않습니다. `dist`와 `artifacts`는 생성물이라 Git에서 제외했습니다.

소스 구분:

- `extension/bridge.js`: 페이지 MAIN world에서 이미 로드된 RequireJS 모듈의 공개 함수·현재 플레이어 상태를 읽습니다. 기존 `comm.handle_message`를 보존하면서 응답을 관찰하며 새로운 WebSocket을 만들지 않습니다.
- `extension/content.js`: isolated world의 최소 UI, 단축키, Chrome 로컬 설정.
- `extension/core.js`: 목록 정규화·메뉴 추적.
- `extension/advisor.js`: 위험도·후보 선정 규칙.
- `tests`: 슬롯 확장, 부분 메뉴, 연결 상태, 시전 시 단축키 변경, 조회 취소, 기술·능력 조회, 저항·MP·아이템 조건 검증.

`storage` 권한과 `crawl.nemelex.cards` 접근만 요청합니다. 로그인 정보는 읽거나 저장하지 않으며 외부 분석 서버·원격 실행 코드·텔레메트리가 없습니다. 페이지와 확장 사이 메시지는 같은 사이트의 스크립트에서도 접근할 수 있으므로 별도의 보안 경계로 취급하지 않습니다.

## 원본 참조

코드는 아래 원본 DCSS의 레이아웃·좌클릭 사용·우클릭 설명·메시지 형식을 참조했습니다. 게임 소스나 타일 시트를 배포물에 복사하지 않으며, 실행 중인 클라이언트의 타일 렌더러를 이용합니다.

- [로컬 인벤토리 영역](https://github.com/crawl/crawl/blob/master/crawl-ref/source/tilereg-inv.cc)
- [로컬 마법 영역](https://github.com/crawl/crawl/blob/master/crawl-ref/source/tilereg-spl.cc)
- [로컬 탭 영역](https://github.com/crawl/crawl/blob/master/crawl-ref/source/tilereg-tab.cc)
- [WebTiles 게임 레이아웃](https://github.com/crawl/crawl/blob/master/crawl-ref/source/webserver/game_data/templates/game.html)
- [플레이어 상태와 소지품](https://github.com/crawl/crawl/blob/master/crawl-ref/source/webserver/game_data/static/player.js)
- [원본 입력 경로](https://github.com/crawl/crawl/blob/master/crawl-ref/source/webserver/static/scripts/client.js)
- [몬스터 목록](https://github.com/crawl/crawl/blob/master/crawl-ref/source/webserver/game_data/static/monster_list.js)
- [위협 등급 계산](https://github.com/crawl/crawl/blob/master/crawl-ref/source/mon-util.cc)
- [서버 메시지 및 아이템 동작](https://github.com/crawl/crawl/blob/master/crawl-ref/source/tileweb.cc)
- [네멜렉스 DWEM](https://github.com/refracta/dcss-webtiles-extension-module)
