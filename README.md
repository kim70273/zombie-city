# 🧟 좀비시티 (Zombie City)

친구들과 즐기는 **2~10인 실시간 좀비 감염 게임**. 설치 없이 브라우저에서 바로 플레이하고, PWA로 설치도 가능합니다.

**▶ 플레이: https://kim70273.github.io/zombie-city/**

## 게임 방법

1. 방장이 **방 만들기** → 5글자 방 코드(또는 링크)를 친구에게 공유
2. 친구들은 코드 입력 후 **준비** — 방장이 플레이 시간(5/10/20/30/50분)을 고르고 시작
3. 시작하면 일부 플레이어가 무작위로 **좀비**가 됩니다 (2~3인: 1명 / 4~6인: 2명 / 7인+: 3명)
4. **좀비**: 시민 NPC와 인간 플레이어를 물어 감염시키세요. 좀비가 된 NPC는 인간을 추격합니다!
5. **인간**: 도망치고, 건물에 숨고, 5분마다 떨어지는 **보급품**(권총·백신)을 차지하세요
   - 🔫 권총: 좀비 NPC와 좀비 플레이어를 처치
   - 💉 백신: 좀비(플레이어/NPC)를 인간으로 되돌림
6. **승리 조건**
   - 좀비 팀: 모든 플레이어 감염
   - 인간 팀: 좀비 플레이어 전멸(사망/치료) 또는 시간 종료까지 생존

## 조작

| | 데스크톱 | 모바일 |
|---|---|---|
| 이동 | WASD / 방향키 | 왼쪽 화면 가상 조이스틱 |
| 공격/사격 | 마우스 클릭 (조준: 마우스) | 공격 버튼 |
| 백신 사용 | E | 💉 버튼 |

## 기술

- **3D 3인칭(숄더뷰)**: Three.js 셀셰이딩(젠레스 존 제로/원신풍 툰 렌더링), 절차 생성 애니메 캐릭터 8종
- 서버 없는 P2P 멀티플레이: 방장 브라우저가 권위 시뮬레이터(20Hz), WebRTC DataChannel(PeerJS)
- **컴퓨터(봇) 플레이어**: 로비에서 "+ 컴퓨터 추가"로 혼자서도 테스트 가능
- 시드 기반 절차적 도시맵 — 모든 클라이언트가 동일 맵을 로컬 생성
- 캐릭터/효과음 전부 절차 생성 (외부 에셋 0)
- Vite + 순수 JS, GitHub Pages 배포, PWA 설치 지원

## 📱 네이티브 앱 출시 (Capacitor)

웹 빌드를 그대로 앱스토어/플레이스토어용 네이티브 앱으로 패키징할 수 있도록 `capacitor.config.json`이 포함되어 있습니다.

```bash
npm i -D @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npm run build
npx cap add android   # 또는 ios (macOS + Xcode 필요)
npx cap sync
npx cap open android  # Android Studio에서 빌드/서명 후 출시
```

WebRTC(PeerJS)는 iOS/Android WebView에서 그대로 동작하므로 추가 네이티브 코드 없이 P2P 멀티플레이가 유지됩니다.

## 개발

```bash
npm install
npm run dev        # http://localhost:5173/zombie-city/
npm test           # vitest (헤드리스 봇 풀매치 포함)
npm run build
node scripts/smoke.mjs   # Chrome 2탭 실제 P2P E2E (개발 서버 필요)
```

캐릭터 디버그 갤러리: 개발 서버에서 `/zombie-city/gallery.html`

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
