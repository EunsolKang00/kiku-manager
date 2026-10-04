import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const firebaseConfig = {
  apiKey: "AIzaSyAUd5S0LBl9NtmGIk53n4twgOs0jKkWGN4",
  authDomain: "kiku-manager.firebaseapp.com",
  projectId: "kiku-manager",
  storageBucket: "kiku-manager.firebasestorage.app",
  messagingSenderId: "519300206278",
  appId: "1:519300206278:web:9878d84638cf3088b2d1c7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();

const ADMIN_EMAILS = ['qeqe147258@gmail.com'];
let currentUser = null;
let isAdmin = false;

const TODAY = new Date();
let members = [], bungs = [], notices = [], playlist = [], seasonAwards = [];
let posts = [], currentBoardType = 'free', currentPostId = null, postComments = [];
let postImageFiles = [], editPostImageFiles = [], editPostExistingImages = [];
let nextMemberId = 1, nextBungId = 1;
let calYear = TODAY.getFullYear(), calMonth = TODAY.getMonth();
let selectedMemberId = null;
let unsubscribers = [];
// 사이드바 버튼 순서와 동일해야 함 (switchTab에서 인덱스로 매칭)
const TABS = ['dashboard','notice','board','settlement','members','bung','ghost','stats','hall','playground','calendar','profile','gallery','updates'];
let currentTab = 'dashboard';

// ── 공통 헬퍼 ─────────────────────────────────────────────────────
// 사용자가 입력한 글(이름·제목·메모 등)을 innerHTML에 넣기 전에 반드시 거치는 이스케이프.
// 게시글 제목 등에 <script>/<img onerror> 같은 HTML이 섞여 들어가 실행되는 것을 막는다.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// onclick="fn(...)" 같은 인라인 핸들러에 문자열 인자를 넣을 때 사용 (따옴표가 들어간 이름도 안전)
function jsArg(s) { return esc(JSON.stringify(String(s ?? ''))); }

// 날짜는 항상 "기기 현지 날짜" 기준 YYYY-MM-DD 문자열로 다룬다.
// (toISOString은 UTC 기준이라 한국 시간 오전 9시 전에는 어제 날짜가 나옴)
function toDateStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayStr() { return toDateStr(TODAY); }
function parseDateStr(s) { const [y,m,d] = String(s).split('-').map(Number); return new Date(y, (m||1)-1, d||1); }
function daysUntil(dateStr) { return Math.round((parseDateStr(dateStr) - parseDateStr(todayStr())) / 86400000); }

// 이름 비교용 정규화: 대소문자·띄어쓰기 무시 (Hyeon = hyeon = HYEON, "고 의석" = "고의석")
function normName(s) { return String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ''); }
function memberAliases(m) { return Array.isArray(m?.aliases) ? m.aliases.filter(Boolean) : []; }
function memberKeys(m) { return [m.name, ...memberAliases(m)].map(normName).filter(Boolean); }
function memberMatchesQuery(m, q) {
  const key = normName(q);
  return !key || memberKeys(m).some(k => k.includes(key));
}
function sortMembersByName(list) { return [...list].sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ko')); }
// 입력한 이름/별명으로 회원 찾기. 1) 이름 정확히 일치 2) 별명 정확히 일치
// 3) (2글자 이상일 때) 이름·별명에 포함되는 회원이 딱 1명이면 그 회원.
// 결과: {member} 이거나, 후보가 여러 명이면 {candidates}, 없으면 {}
function resolveMemberInput(q) {
  const key = normName(q);
  if (!key) return {};
  const byName = members.filter(m => normName(m.name) === key);
  if (byName.length === 1) return {member: byName[0]};
  if (byName.length > 1) return {candidates: byName};
  const byAlias = members.filter(m => memberAliases(m).some(a => normName(a) === key));
  if (byAlias.length === 1) return {member: byAlias[0]};
  if (byAlias.length > 1) return {candidates: byAlias};
  if ([...key].length < 2) return {};
  const partial = members.filter(m => memberKeys(m).some(k => k.includes(key)));
  if (partial.length === 1) return {member: partial[0]};
  if (partial.length > 1) return {candidates: partial};
  return {};
}
function parseAliasInput(str, ownName) {
  const own = normName(ownName);
  const seen = new Set();
  return String(str ?? '').split(/[,，、\n]+/).map(s => s.trim()).filter(s => {
    const k = normName(s);
    if (!k || k === own || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 10);
}
// 다른 회원 이름/별명과 겹치는 별명 찾기 (겹치면 입력할 때 누구인지 헷갈리므로 저장 전에 알려줌)
function findAliasConflicts(aliases, selfId) {
  const out = [];
  aliases.forEach(a => {
    const k = normName(a);
    members.forEach(m => { if (m.id !== selfId && memberKeys(m).includes(k)) out.push(`"${a}" ↔ ${m.name}`); });
  });
  return out;
}

// 한글 입력(IME) 중 엔터를 누르면 마지막 글자가 입력칸에 남거나 두 번 실행되는 문제를 피하는 엔터 처리
function onEnterKey(e, fn) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  if (e.isComposing) {
    // 조합이 끝난 뒤 실행 (compositionend가 오지 않는 키보드도 있어서 잠시 후 한 번 더 시도, 실행은 한 번만)
    let fired = false;
    const run = () => { if (!fired) { fired = true; setTimeout(fn, 0); } };
    e.target.addEventListener('compositionend', run, {once: true});
    setTimeout(run, 300);
    return;
  }
  fn();
}
window.onEnterKey = onEnterKey;

// 화면 하단에 잠깐 떴다 사라지는 알림
function toast(msg, type = 'success') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toast-wrap'; document.body.appendChild(wrap); }
  const icon = type === 'error' ? 'alert-circle' : type === 'info' ? 'info-circle' : 'circle-check';
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.setAttribute('role', 'status');
  t.innerHTML = `<i class="ti ti-${icon}"></i><span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, type === 'error' ? 3200 : 2200);
}

// 저장 버튼을 빠르게 두 번 눌러 같은 데이터가 두 번 저장되는 것을 막는다.
// 처리 중에는 누른 버튼을 잠깐 비활성화(로딩 표시)하고, 끝나면 원래대로 돌린다.
const _busyActions = new Set();
function guardAction(name) {
  const fn = window[name];
  window[name] = async function(...args) {
    if (_busyActions.has(name)) return;
    const btn = window.event?.target?.closest?.('button');
    _busyActions.add(name);
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    try { return await fn.apply(this, args); }
    catch (e) { console.error(e); toast('처리 중 오류가 발생했습니다: ' + (e.message || e), 'error'); }
    finally {
      _busyActions.delete(name);
      if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('is-busy'); }
    }
  };
}

window.signInWithGoogle = async function() {
  const agreeEl = document.getElementById('terms-agree');
  if (agreeEl && !agreeEl.checked) {
    document.getElementById('login-status').textContent = '개인정보 수집·이용에 동의해주세요.';
    return;
  }
  document.getElementById('login-status').textContent = '로그인 중...';
  try {
    await signInWithPopup(auth, provider);
  } catch(e) {
    // 팝업이 막히거나 지원되지 않는 환경(일부 인앱 브라우저 등)이면 리다이렉트로 폴백
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment' || e.code === 'auth/cancelled-popup-request') {
      try {
        await signInWithRedirect(auth, provider);
      } catch(e2) {
        document.getElementById('login-status').textContent = '로그인 실패: ' + e2.message;
      }
    } else if (e.code === 'auth/popup-closed-by-user') {
      document.getElementById('login-status').textContent = '';
    } else {
      document.getElementById('login-status').textContent = '로그인 실패: ' + e.message + ' (' + (e.code||'') + ')';
    }
  }
};

window.openTermsModal = function() {
  openModal(`<div class="modal-title"><i class="ti ti-shield-check" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>개인정보 수집·이용 안내</div>
    <div style="font-size:13px;line-height:1.8;max-height:50vh;overflow-y:auto;margin-bottom:16px">
      <p><strong>1. 수집 항목</strong><br>Google 계정의 이름, 이메일 주소, 프로필 사진(선택 시)</p>
      <p><strong>2. 수집 목적</strong><br>KIKU 소모임 회원 식별 및 회원 프로필 연동, 운영진 권한 확인</p>
      <p><strong>3. 보유 및 이용 기간</strong><br>회원 탈퇴 또는 연결 해제 요청 시까지 보관하며, 요청 시 즉시 삭제합니다.</p>
      <p><strong>4. 제3자 제공</strong><br>수집된 정보는 외부에 제공되지 않으며, 운영진 확인 목적으로만 사용됩니다.</p>
      <p><strong>5. 동의 거부 권리</strong><br>동의하지 않을 경우 Google 로그인 기반 기능(프로필 연동 등) 이용이 제한되며, 로그인 없이도 일부 정보 열람은 가능합니다.</p>
      <p><strong>6. 문의</strong><br>운영진 이메일(qeqe147258@gmail.com)로 문의해주세요.</p>
    </div>
    <div class="flex" style="justify-content:flex-end"><button class="btn btn-primary" onclick="closeModal()">확인</button></div>`);
};

window.enterAsGuest = function() {
  currentUser = null;
  isAdmin = false;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('sidebar-user').innerHTML = `<i class="ti ti-eye" style="font-size:12px"></i>게스트 (둘러보기)`;
  const authBtn = document.getElementById('auth-action-btn');
  if (authBtn) authBtn.innerHTML = '<i class="ti ti-login"></i> 로그인';
  if (authBtn) authBtn.setAttribute('onclick', 'exitGuestMode()');
  updateEditMode();
  initTheme();
  loadData();
  restoreTabFromHash();
};

function hideBootSplash() {
  const el = document.getElementById('boot-splash');
  if (!el || el.classList.contains('hide')) return;
  el.classList.add('hide');
  setTimeout(() => el.remove(), 400);
}

window.exitGuestMode = function() {
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
};

window.requireLogin = function(msg) {
  alert(msg || '로그인이 필요한 기능입니다.');
  return false;
};

window.signOut = async function() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  await fbSignOut(auth);
};

function resetAuthActionBtn() {
  const authBtn = document.getElementById('auth-action-btn');
  if (!authBtn) return;
  authBtn.innerHTML = '<i class="ti ti-logout"></i> 로그아웃';
  authBtn.setAttribute('onclick', 'signOut()');
}

initTheme();

onAuthStateChanged(auth, async user => {
  try {
    await getRedirectResult(auth);
  } catch(e) {
    const statusEl = document.getElementById('login-status');
    if (statusEl) statusEl.textContent = '로그인 실패: ' + e.message + ' (' + (e.code||'') + ')';
  }
  hideBootSplash();
  if (user) {
    currentUser = user;
    isAdmin = ADMIN_EMAILS.includes(user.email);
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    resetAuthActionBtn();
    updateSidebarUserDisplay();
    updateEditMode();
    initTheme();
    await loadData();
    restoreTabFromHash();
    setTimeout(checkProfileLink, 600);
  } else {
    currentUser = null;
    isAdmin = false;
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  }
});

function updateSidebarUserDisplay() {
  const sidebarUser = document.getElementById('sidebar-user');
  if (!sidebarUser || !currentUser) return;
  const name = authorDisplayName();
  sidebarUser.innerHTML = `<i class="ti ti-user" style="font-size:12px"></i>${esc(name)}${isAdmin?'<span style="font-size:10px;background:var(--warn-bg);color:var(--warn);padding:1px 5px;border-radius:3px;margin-left:4px">운영진</span>':''}`;
}

function refreshAdminStatus() {
  if (!currentUser) return;
  const me = members.find(m => m.linkedUid === currentUser.uid);
  isAdmin = ADMIN_EMAILS.includes(currentUser.email) || (me && (me.role === 'admin' || me.role === 'host'));
  updateEditMode();
  updateSidebarUserDisplay();
}

async function loadData() {
  setSyncStatus('loading', '데이터 불러오는 중...');
  // 실시간 연결이 끊기거나 권한 오류가 나면 상단 상태 표시줄에 알려줌 (예전에는 조용히 멈춤)
  const onSnapError = e => setSyncStatus('disconnected', '연결 오류: ' + (e?.message || e) + ' — 새로고침해주세요');
  try {
    const memberUnsub = onSnapshot(collection(db, 'members'), snap => {
      members = snap.docs.map(d => ({id: d.id, ...d.data()}));
      nextMemberId = members.length > 0 ? Math.max(...members.map(m => parseInt(m.numId)||0)) + 1 : 1;
      refreshAdminStatus();
      renderAll();
      checkAndFinalizeSeasonAwards();
    }, onSnapError);
    const bungUnsub = onSnapshot(query(collection(db, 'bungs'), orderBy('date', 'desc')), snap => {
      bungs = snap.docs.map(d => ({id: d.id, ...d.data()}));
      nextBungId = bungs.length > 0 ? Math.max(...bungs.map(b => parseInt(b.numId)||0)) + 1 : 1;
      renderAll();
    }, onSnapError);
    const noticeUnsub = onSnapshot(query(collection(db, 'notices'), orderBy('createdAt', 'desc')), snap => {
      notices = snap.docs.map(d => ({id: d.id, ...d.data()}));
      renderNotices();
      updateNoticeDot();
    });
    const postUnsub = onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc')), snap => {
      posts = snap.docs.map(d => ({id: d.id, ...d.data()}));
      renderBoardList();
      renderTodaySong();
    });
    const playlistUnsub = onSnapshot(collection(db, 'playlist'), snap => {
      playlist = snap.docs.map(d => ({id: d.id, ...d.data()}));
      renderTodaySong();
      renderPlaylistManager();
    });
    const seasonAwardUnsub = onSnapshot(collection(db, 'seasonAwards'), snap => {
      seasonAwards = snap.docs.map(d => ({id: d.id, ...d.data()}));
      renderDashboardAchievements();
      checkAndFinalizeSeasonAwards();
    });
    // 유령 정리 완료 기록 (다른 운영진이 정리를 마치면 내 화면도 다음 정리 기준으로 바뀜). 권한이 없으면 무시.
    const ghostDoneUnsub = onSnapshot(doc(db, 'settings', 'ghostCleanup'), snap => {
      if (snap.exists() && rememberGhostDoneCycle(snap.data().doneCycle)) renderAll();
    }, () => {});
    unsubscribers = [memberUnsub, bungUnsub, noticeUnsub, postUnsub, playlistUnsub, seasonAwardUnsub, ghostDoneUnsub];
    setSyncStatus('connected', '실시간 동기화 중');
  } catch(e) {
    setSyncStatus('disconnected', '연결 실패: ' + e.message);
  }
}

function setSyncStatus(state, msg) {
  document.getElementById('sync-dot').className = 'drive-dot ' + state;
  document.getElementById('sync-status').textContent = msg;
}

window.exportBackup = async function() {
  // 화면에 로드된 데이터 + 정산 내역까지 함께 백업
  let settlements = [];
  try { settlements = (await getDocs(collection(db, 'settlements'))).docs.map(d => ({id: d.id, ...d.data()})); } catch(e) {}
  const data = {members, bungs, notices, posts, playlist, seasonAwards, settlements, exportedAt: new Date().toISOString()};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `kiku_backup_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('백업 파일을 저장했어요');
};

// 공지 빨간 점: 마지막으로 공지 탭을 본 이후 새 공지가 있을 때만 표시
function latestNoticeSeconds() { return notices.reduce((mx, n) => Math.max(mx, n.createdAt?.seconds || 0), 0); }
function markNoticesSeen() {
  try { localStorage.setItem('kiku-notice-seen', String(latestNoticeSeconds())); } catch(e) {}
}
function updateNoticeDot() {
  const dot = document.getElementById('notice-dot');
  if (!dot) return;
  if (currentTab === 'notice') markNoticesSeen();
  let seen = 0;
  try { seen = parseInt(localStorage.getItem('kiku-notice-seen') || '0', 10) || 0; } catch(e) {}
  dot.style.display = notices.some(n => (n.createdAt?.seconds || 0) > seen) ? '' : 'none';
}

function renderNotices() {
  const el = document.getElementById('notice-list');
  if (!el) return;
  if (notices.length === 0) {
    el.innerHTML = '<div class="empty-state"><i class="ti ti-speakerphone"></i>등록된 공지사항이 없습니다.</div>';
    return;
  }
  const pinned = notices.filter(n => n.pinned);
  const normal = notices.filter(n => !n.pinned);
  const sorted = [...pinned, ...normal];
  el.innerHTML = sorted.map(n => {
    const date = n.createdAt ? new Date(n.createdAt.seconds * 1000) : new Date();
    const tagClass = n.pinned ? 'pinned' : n.important ? 'important' : 'normal';
    const tagLabel = n.pinned ? '📌 고정' : n.important ? '❗ 중요' : '📢 공지';
    return `<div class="notice-card ${n.pinned ? 'notice-pinned' : ''}" onclick="openNoticeDetail('${n.id}')">
      <div class="flex-between mb-1">
        <div class="flex" style="min-width:0;flex:1">
          <span class="notice-tag ${tagClass}" style="flex-shrink:0">${tagLabel}</span>
          <strong style="font-size:14px">${esc(n.title)}</strong>
        </div>
        <div class="flex" style="gap:4px;flex-shrink:0">
          ${isAdmin ? `<button class="btn btn-sm edit-only" onclick="event.stopPropagation();openEditNotice('${n.id}')"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-danger edit-only" onclick="event.stopPropagation();deleteNotice('${n.id}')"><i class="ti ti-trash"></i></button>` : ''}
        </div>
      </div>
      <div style="font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:6px">${esc(n.content)}</div>
      <div style="font-size:11px;color:var(--text3)">${esc(resolveAuthorName(n.authorUid, n.authorName) || '운영진')} · ${formatDate(date)}</div>
    </div>`;
  }).join('');
}

window.openNoticeDetail = function(id) {
  const n = notices.find(x => x.id === id);
  if (!n) return;
  const date = n.createdAt ? new Date(n.createdAt.seconds * 1000) : new Date();
  openModal(`<div class="modal-title">${n.pinned ? '📌 ' : ''}${esc(n.title)}</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">${esc(resolveAuthorName(n.authorUid, n.authorName) || '운영진')} · ${formatDate(date)}</div>
    <div style="font-size:13px;line-height:1.8;margin-bottom:16px">${renderClampedText(n.content, 500)}</div>
    <div class="flex" style="justify-content:flex-end"><button class="btn btn-primary" onclick="closeModal()">닫기</button></div>`);
};

window.openAddNotice = function() {
  openModal(`<div class="modal-title"><i class="ti ti-speakerphone" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>공지 작성</div>
    <div class="form-group"><label>제목</label><input type="text" id="n-title" placeholder="공지 제목" autofocus></div>
    <div class="form-group"><label>내용</label><textarea id="n-content" placeholder="공지 내용을 입력하세요" style="min-height:120px"></textarea></div>
    <div class="flex" style="gap:16px;margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="n-pinned"> 상단 고정</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="n-important"> 중요 표시</label>
    </div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="addNotice()">등록</button></div>`);
};

window.addNotice = async function() {
  const title = document.getElementById('n-title').value.trim();
  const content = document.getElementById('n-content').value.trim();
  if (!title || !content) { alert('제목과 내용을 입력해주세요.'); return; }
  await addDoc(collection(db, 'notices'), {
    title, content,
    pinned: document.getElementById('n-pinned').checked,
    important: document.getElementById('n-important').checked,
    authorName: authorDisplayName(),
    authorUid: currentUser.uid,
    authorEmail: currentUser.email,
    createdAt: serverTimestamp(),
  });
  closeModal();
  toast('공지를 등록했어요');
};

window.openEditNotice = function(id) {
  const n = notices.find(x => x.id === id);
  if (!n) return;
  openModal(`<div class="modal-title"><i class="ti ti-edit" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>공지 수정</div>
    <div class="form-group"><label>제목</label><input type="text" id="en-title" value="${esc(n.title)}"></div>
    <div class="form-group"><label>내용</label><textarea id="en-content" style="min-height:120px">${esc(n.content)}</textarea></div>
    <div class="flex" style="gap:16px;margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="en-pinned" ${n.pinned?'checked':''}> 상단 고정</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="en-important" ${n.important?'checked':''}> 중요 표시</label>
    </div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="editNotice('${id}')">저장</button></div>`);
};

window.editNotice = async function(id) {
  const title = document.getElementById('en-title').value.trim();
  const content = document.getElementById('en-content').value.trim();
  if (!title || !content) { alert('제목과 내용을 입력해주세요.'); return; }
  await updateDoc(doc(db, 'notices', id), {
    title, content,
    pinned: document.getElementById('en-pinned').checked,
    important: document.getElementById('en-important').checked,
  });
  closeModal();
  toast('공지를 수정했어요');
};

window.deleteNotice = async function(id) {
  const n = notices.find(x => x.id === id);
  if (!n || !confirm(`"${n.title}" 공지를 삭제할까요?`)) return;
  await deleteDoc(doc(db, 'notices', id));
};

// ── 게시판 (자유게시판/건의사항) ──────────────────────────────────
// ── 긴 텍스트 처리 (글자 수 제한 + 더보기) ──────────────────────────
let clampIdCounter = 0;
function renderClampedText(text, limit) {
  const safe = (text||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  if (safe.length <= limit) return `<span style="white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word">${safe}</span>`;
  const id = `clamp-${clampIdCounter++}`;
  const short = safe.slice(0, limit);
  return `<span id="${id}" style="white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word" data-full="${encodeURIComponent(safe)}" data-short="${encodeURIComponent(short)}" data-expanded="0">${short}<span style="color:var(--info)">... </span><a href="#" onclick="event.preventDefault();toggleClamp('${id}')" style="color:var(--info);font-size:12px;text-decoration:underline">더보기</a></span>`;
}
window.toggleClamp = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const expanded = el.getAttribute('data-expanded') === '1';
  const full = decodeURIComponent(el.getAttribute('data-full'));
  const short = decodeURIComponent(el.getAttribute('data-short'));
  if (expanded) {
    el.innerHTML = `${short}<span style="color:var(--info)">... </span><a href="#" onclick="event.preventDefault();toggleClamp('${id}')" style="color:var(--info);font-size:12px;text-decoration:underline">더보기</a>`;
    el.setAttribute('data-expanded', '0');
  } else {
    el.innerHTML = `${full} <a href="#" onclick="event.preventDefault();toggleClamp('${id}')" style="color:var(--info);font-size:12px;text-decoration:underline">접기</a>`;
    el.setAttribute('data-expanded', '1');
  }
};

const MAX_POST_IMAGES = 4;

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const val = textarea.value;
  textarea.value = val.slice(0, start) + text + val.slice(end);
  const pos = start + text.length;
  textarea.selectionStart = textarea.selectionEnd = pos;
  textarea.focus();
}

window.handlePostImageSelect = function(input) {
  const textarea = document.getElementById('p-content');
  const files = [...input.files];
  for (const file of files) {
    if (postImageFiles.length >= MAX_POST_IMAGES) { alert(`사진은 최대 ${MAX_POST_IMAGES}장까지 첨부할 수 있습니다.`); break; }
    const idx = postImageFiles.length + 1;
    postImageFiles.push(file);
    insertAtCursor(textarea, `\n[이미지${idx}]\n`);
  }
  input.value = '';
  renderPostImagePreview();
};

function renderPostImagePreview() {
  const el = document.getElementById('p-image-preview');
  if (!el) return;
  el.innerHTML = postImageFiles.map((f,i) => `<div style="position:relative">
    <img src="${URL.createObjectURL(f)}" style="width:60px;height:60px;object-fit:cover;border-radius:var(--radius)">
    <span style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;display:flex;align-items:center;justify-content:center;cursor:pointer" onclick="removePostImage(${i})">×</span>
    <span style="position:absolute;bottom:-2px;left:-2px;background:rgba(0,0,0,0.6);color:#fff;font-size:9px;padding:0 4px;border-radius:3px">${i+1}</span>
  </div>`).join('');
}

window.removePostImage = function(i) {
  postImageFiles.splice(i, 1);
  renderPostImagePreview();
};

window.removeEditPostImage = function(i, isExisting) {
  if (isExisting) editPostExistingImages.splice(i, 1);
  else editPostImageFiles.splice(i, 1);
  renderEditPostImagePreview();
};

function renderEditPostImagePreview() {
  const el = document.getElementById('ep-image-preview');
  if (!el) return;
  const existingHtml = editPostExistingImages.map((url,i) => `<div style="position:relative">
    <img src="${esc(url)}" style="width:60px;height:60px;object-fit:cover;border-radius:var(--radius)">
    <span style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;display:flex;align-items:center;justify-content:center;cursor:pointer" onclick="removeEditPostImage(${i},true)">×</span>
  </div>`).join('');
  const newHtml = editPostImageFiles.map((f,i) => `<div style="position:relative">
    <img src="${URL.createObjectURL(f)}" style="width:60px;height:60px;object-fit:cover;border-radius:var(--radius)">
    <span style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;display:flex;align-items:center;justify-content:center;cursor:pointer" onclick="removeEditPostImage(${i},false)">×</span>
    <span style="position:absolute;bottom:-2px;left:-2px;background:rgba(0,0,0,0.6);color:#fff;font-size:9px;padding:0 4px;border-radius:3px">new</span>
  </div>`).join('');
  el.innerHTML = existingHtml + newHtml;
}

window.handleEditPostImageSelect = function(input) {
  const textarea = document.getElementById('ep-content');
  const files = [...input.files];
  for (const file of files) {
    if (editPostExistingImages.length + editPostImageFiles.length >= MAX_POST_IMAGES) { alert(`사진은 최대 ${MAX_POST_IMAGES}장까지 첨부할 수 있습니다.`); break; }
    const idx = editPostExistingImages.length + editPostImageFiles.length + 1;
    editPostImageFiles.push(file);
    insertAtCursor(textarea, `\n[이미지${idx}]\n`);
  }
  input.value = '';
  renderEditPostImagePreview();
};

async function uploadPostImages(files) {
  const urls = [];
  for (const file of files) {
    const storageRef = ref(storage, `posts/${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name}`);
    await uploadBytes(storageRef, file);
    urls.push(await getDownloadURL(storageRef));
  }
  return urls;
}

// 본문 텍스트 안의 [이미지N] 자리에 실제 이미지를 끼워넣어 렌더링
function renderPostBodyWithImages(content, images) {
  const safe = (content||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const parts = safe.split(/\[이미지(\d+)\]/g);
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      html += `<span style="white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word">${parts[i]}</span>`;
    } else {
      const imgIdx = parseInt(parts[i]) - 1;
      const url = (images||[])[imgIdx];
      if (url) html += `<img src="${esc(url)}" style="max-width:100%;border-radius:var(--radius-lg);margin:10px 0;display:block" loading="lazy">`;
    }
  }
  return html;
}

function authorDisplayName() {
  const me = getMyMember();
  return me ? me.name : (currentUser.displayName || currentUser.email);
}

// uid로 현재 연결된 프로필 닉네임을 실시간 조회. 연결된 프로필이 없으면 저장된 이름(fallback) 사용.
// 회원이 닉네임을 바꿔도 과거 글/댓글/메시지에 항상 최신 닉네임이 표시되도록 함.
function resolveAuthorName(uid, fallback) {
  if (uid) {
    const m = members.find(x => x.linkedUid === uid);
    if (m) return m.name;
  }
  return fallback || '회원';
}

window.switchBoardType = function(type) {
  currentBoardType = type;
  document.querySelectorAll('.board-tab').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  const descMap = {free:'자유롭게 이야기를 나눠보세요.', suggestion:'운영진에게 건의사항을 전달해보세요. 익명 작성이 가능합니다.', song:'함께 부르고 싶은 노래를 추천해보세요. 추천곡은 대시보드 "오늘의 노래"에도 노출됩니다.'};
  document.getElementById('board-desc').textContent = descMap[type] || '';
  document.getElementById('board-detail').style.display = 'none';
  document.getElementById('board-list').style.display = '';
  renderBoardList();
};

function renderBoardList() {
  const el = document.getElementById('board-list');
  if (!el) return;
  const list = posts.filter(p => p.type === currentBoardType);
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-message-2"></i>등록된 글이 없습니다.</div>`;
    return;
  }
  el.innerHTML = list.map(p => {
    const date = p.createdAt ? new Date(p.createdAt.seconds * 1000) : new Date();
    const displayName = p.anonymous ? '익명' : resolveAuthorName(p.authorUid, p.authorName);
    const canManage = isAdmin || (currentUser && p.authorUid === currentUser.uid);
    const titleHtml = p.type === 'song' ? `<i class="ti ti-music" style="color:var(--purple);margin-right:4px"></i>${esc(p.title)}` : esc(p.title);
    const previewText = esc((p.content||'').replace(/\[이미지\d+\]/g, '📷 ').trim());
    return `<div class="notice-card" onclick="openPostDetail('${p.id}')">
      <div class="flex-between mb-1">
        <strong style="font-size:14px;min-width:0">${titleHtml}</strong>
        <div class="flex" style="gap:4px;flex-shrink:0">
          ${canManage ? `<button class="btn btn-sm" onclick="event.stopPropagation();openEditPost('${p.id}')"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deletePost('${p.id}')"><i class="ti ti-trash"></i></button>` : ''}
        </div>
      </div>
      <div style="font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:6px">${previewText}${p.images&&p.images.length>0?` <span style="color:var(--text3);font-size:11px">(사진 ${p.images.length}장)</span>`:''}</div>
      <div style="font-size:11px;color:var(--text3);display:flex;gap:8px;align-items:center">
        <span>${esc(displayName)} · ${formatDate(date)}</span>
        <span><i class="ti ti-message-circle" style="font-size:11px;vertical-align:-1px"></i> ${p.commentCount||0}</span>
      </div>
    </div>`;
  }).join('');
}

window.searchYoutubeFor = function(songId, artistId) {
  const song = document.getElementById(songId)?.value.trim()||'';
  const artist = document.getElementById(artistId)?.value.trim()||'';
  if (!song) { alert('곡명을 먼저 입력해주세요.'); return; }
  const q = encodeURIComponent(`${song} ${artist}`.trim());
  window.open(`https://www.youtube.com/results?search_query=${q}`, '_blank');
};

window.openAddPost = function() {
  if (!currentUser) return requireLogin('글쓰기는 로그인 후 이용할 수 있습니다.');
  const isSuggestion = currentBoardType === 'suggestion';
  const isSong = currentBoardType === 'song';
  if (isSong) {
    openModal(`<div class="modal-title"><i class="ti ti-music" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>노래 추천하기</div>
      <div class="form-row">
        <div class="form-group"><label>곡명</label><input type="text" id="p-song" placeholder="예: Lemon" autofocus></div>
        <div class="form-group"><label>아티스트</label><input type="text" id="p-artist" placeholder="예: 요네즈 켄시"></div>
      </div>
      <div class="form-group"><label>유튜브 링크 (선택)</label>
        <div class="flex" style="gap:6px">
          <input type="text" id="p-youtube" placeholder="https://youtu.be/..." style="flex:1">
          <button type="button" class="btn btn-sm" onclick="searchYoutubeFor('p-song','p-artist')"><i class="ti ti-search"></i> 유튜브에서 찾기</button>
        </div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">⚠️ 유튜브 링크가 없으면 이 곡은 노래 이상형월드컵 후보에 들어갈 수 없어요.</div>
      </div>
      <div class="form-group"><label>추천 이유 (선택)</label><textarea id="p-content" placeholder="이 노래를 추천하는 이유를 적어주세요" style="min-height:100px"></textarea></div>
      <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="addPost()">등록</button></div>`);
    return;
  }
  openModal(`<div class="modal-title"><i class="ti ti-edit" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>${isSuggestion?'건의사항':'자유게시판'} 글쓰기</div>
    <div class="form-group"><label>제목</label><input type="text" id="p-title" placeholder="제목을 입력하세요" autofocus></div>
    <div class="form-group"><label>내용</label><textarea id="p-content" placeholder="내용을 입력하세요" style="min-height:140px"></textarea></div>
    <div class="form-group">
      <label>사진 첨부 (최대 4장)</label>
      <input type="file" id="p-images" accept="image/*" multiple onchange="handlePostImageSelect(this)">
      <div style="font-size:11px;color:var(--text2);margin-top:4px">사진을 선택하면 본문 커서 위치에 <code>[이미지]</code> 표시가 들어갑니다. 글 안에서 원하는 자리로 옮겨도 됩니다.</div>
      <div id="p-image-preview" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"></div>
    </div>
    ${isSuggestion?`<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;margin-bottom:12px"><input type="checkbox" id="p-anon"> 익명으로 작성</label>`:''}
    <div id="p-upload-status" style="font-size:12px;color:var(--text2);margin-bottom:8px"></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="addPost()">등록</button></div>`);
  postImageFiles = [];
};

window.addPost = async function() {
  const isSong = currentBoardType === 'song';
  let title, songName, artistName, youtubeUrl='';
  if (isSong) {
    songName = document.getElementById('p-song').value.trim();
    artistName = document.getElementById('p-artist').value.trim();
    if (!songName) { alert('곡명을 입력해주세요.'); return; }
    title = artistName ? `${songName} - ${artistName}` : songName;
    youtubeUrl = document.getElementById('p-youtube').value.trim();
    if (youtubeUrl && !getYoutubeId(youtubeUrl)) { alert('유튜브 링크 형식이 올바르지 않아요. 링크를 다시 확인해주세요.'); return; }
  } else {
    title = document.getElementById('p-title').value.trim();
  }
  const content = document.getElementById('p-content').value.trim();
  if (!isSong && (!title || !content)) { alert('제목과 내용을 입력해주세요.'); return; }
  const anon = document.getElementById('p-anon')?.checked || false;
  const statusEl = document.getElementById('p-upload-status');
  let images = [];
  if (postImageFiles.length > 0) {
    if (statusEl) statusEl.textContent = `사진 업로드 중... (0/${postImageFiles.length})`;
    try {
      images = await uploadPostImages(postImageFiles);
    } catch(e) {
      if (statusEl) statusEl.textContent = '사진 업로드 실패: ' + e.message;
      return;
    }
  }
  const data = {
    type: currentBoardType, title, content,
    images,
    anonymous: anon,
    authorName: authorDisplayName(),
    authorUid: currentUser.uid,
    authorEmail: currentUser.email,
    commentCount: 0,
    createdAt: serverTimestamp(),
  };
  if (isSong) { data.songName = songName; data.artistName = artistName; data.youtubeUrl = youtubeUrl; }
  await addDoc(collection(db, 'posts'), data);
  postImageFiles = [];
  closeModal();
  toast(isSong ? '노래를 추천했어요 🎵' : '글을 등록했어요');
};

window.openEditPost = function(id) {
  const p = posts.find(x => x.id === id);
  if (!p) return;
  editPostExistingImages = [...(p.images||[])];
  editPostImageFiles = [];
  openModal(`<div class="modal-title"><i class="ti ti-edit" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>글 수정</div>
    <div class="form-group"><label>제목</label><input type="text" id="ep-title" value="${esc(p.title)}"></div>
    <div class="form-group"><label>내용</label><textarea id="ep-content" style="min-height:140px">${esc(p.content)}</textarea></div>
    <div class="form-group">
      <label>사진 첨부 (최대 4장)</label>
      <input type="file" id="ep-images" accept="image/*" multiple onchange="handleEditPostImageSelect(this)">
      <div style="font-size:11px;color:var(--text2);margin-top:4px">사진을 선택하면 본문 커서 위치에 <code>[이미지]</code> 표시가 들어갑니다.</div>
      <div id="ep-image-preview" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"></div>
    </div>
    <div id="ep-upload-status" style="font-size:12px;color:var(--text2);margin-bottom:8px"></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="editPost('${id}')">저장</button></div>`);
  renderEditPostImagePreview();
};

window.editPost = async function(id) {
  const title = document.getElementById('ep-title').value.trim();
  const content = document.getElementById('ep-content').value.trim();
  if (!title || !content) { alert('제목과 내용을 입력해주세요.'); return; }
  const statusEl = document.getElementById('ep-upload-status');
  let images = [...editPostExistingImages];
  if (editPostImageFiles.length > 0) {
    if (statusEl) statusEl.textContent = '사진 업로드 중...';
    try {
      const uploaded = await uploadPostImages(editPostImageFiles);
      images = images.concat(uploaded);
    } catch(e) {
      if (statusEl) statusEl.textContent = '사진 업로드 실패: ' + e.message;
      return;
    }
  }
  await updateDoc(doc(db, 'posts', id), {title, content, images});
  editPostImageFiles = []; editPostExistingImages = [];
  closeModal();
  toast('글을 수정했어요');
};

window.deletePost = async function(id) {
  const p = posts.find(x => x.id === id);
  if (!p || !confirm(`"${p.title}" 글을 삭제할까요?`)) return;
  await deleteDoc(doc(db, 'posts', id));
};

window.openPostDetail = async function(id) {
  currentPostId = id;
  document.getElementById('board-list').style.display = 'none';
  const wrap = document.getElementById('board-detail');
  wrap.style.display = '';
  wrap.innerHTML = `<div style="font-size:13px;color:var(--text2)">불러오는 중...</div>`;
  await loadComments(id);
  renderPostDetail();
};

async function loadComments(postId) {
  const snap = await getDocs(query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc')));
  postComments = snap.docs.map(d => ({id: d.id, ...d.data()}));
}

function renderPostDetail() {
  const p = posts.find(x => x.id === currentPostId);
  const wrap = document.getElementById('board-detail');
  if (!p || !wrap) return;
  const date = p.createdAt ? new Date(p.createdAt.seconds * 1000) : new Date();
  const displayName = p.anonymous ? '익명' : resolveAuthorName(p.authorUid, p.authorName);
  wrap.innerHTML = `
    <button class="btn btn-sm" style="margin-bottom:12px" onclick="closePostDetail()"><i class="ti ti-arrow-left"></i> 목록으로</button>
    <div class="notice-card" style="cursor:default">
      <div style="font-size:17px;font-weight:500;margin-bottom:6px">${esc(p.title)}</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px">${esc(displayName)} · ${formatDate(date)}</div>
      <div style="font-size:14px;line-height:1.8">${(p.images&&p.images.length>0) ? renderPostBodyWithImages(p.content, p.images) : renderClampedText(p.content, 500)}</div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:13px;font-weight:500;margin-bottom:10px">댓글 ${postComments.length}개</div>
      <div id="comment-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
        ${postComments.length===0?'<div style="font-size:13px;color:var(--text2)">첫 댓글을 남겨보세요.</div>':postComments.map(c=>{
          const cdate = c.createdAt ? new Date(c.createdAt.seconds*1000) : new Date();
          const canDel = isAdmin || (currentUser && c.authorUid === currentUser.uid);
          return `<div style="background:var(--bg2);border-radius:var(--radius);padding:10px 12px">
            <div class="flex-between"><span style="font-size:12px;font-weight:500">${esc(resolveAuthorName(c.authorUid, c.authorName))}</span>
            ${canDel?`<button class="btn btn-sm" style="padding:2px 6px" onclick="deleteComment('${c.id}')"><i class="ti ti-trash" style="font-size:12px"></i></button>`:''}</div>
            <div style="font-size:13px;margin-top:4px">${renderClampedText(c.content, 300)}</div>
            <div style="font-size:10px;color:var(--text3);margin-top:4px">${formatDate(cdate)}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="flex" style="gap:8px">
        <input type="text" id="comment-input" placeholder="댓글을 입력하세요" style="flex:1" onkeydown="onEnterKey(event, addComment)">
        <button class="btn btn-primary btn-sm" onclick="addComment()">등록</button>
      </div>
    </div>`;
}

window.closePostDetail = function() {
  currentPostId = null;
  document.getElementById('board-detail').style.display = 'none';
  document.getElementById('board-list').style.display = '';
};

window.addComment = async function() {
  if (!currentUser) return requireLogin('댓글 작성은 로그인 후 이용할 수 있습니다.');
  const input = document.getElementById('comment-input');
  const content = input.value.trim();
  if (!content) return;
  await addDoc(collection(db, 'posts', currentPostId, 'comments'), {
    content,
    authorName: authorDisplayName(),
    authorUid: currentUser.uid,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'posts', currentPostId), {commentCount: postComments.length + 1});
  input.value = '';
  await loadComments(currentPostId);
  renderPostDetail();
};

window.deleteComment = async function(commentId) {
  if (!confirm('댓글을 삭제할까요?')) return;
  await deleteDoc(doc(db, 'posts', currentPostId, 'comments', commentId));
  await updateDoc(doc(db, 'posts', currentPostId), {commentCount: Math.max(0, postComments.length - 1)});
  await loadComments(currentPostId);
  renderPostDetail();
};

// ── 회원 CRUD ─────────────────────────────────────────────────────
const ALIAS_HINT = '벙 참석자·정산 이름을 입력할 때 별명으로도 찾을 수 있어요. 대소문자·띄어쓰기는 구분하지 않아요.';

window.openAddMember = function() {
  openModal(`<div class="modal-title"><i class="ti ti-user-plus" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>회원 추가</div>
    <div class="form-row"><div class="form-group"><label>이름</label><input type="text" id="m-name" placeholder="닉네임" autofocus></div><div class="form-group"><label>가입일</label><input type="date" id="m-join" value="${todayStr()}"></div></div>
    <div class="form-group"><label>별명 (선택)</label><input type="text" id="m-aliases" placeholder="예: 의석, uiseok — 쉼표로 여러 개"><div class="settle-hint">${ALIAS_HINT}</div></div>
    <div class="form-group"><label>메모 (선택)</label><textarea id="m-memo" placeholder="특이사항 등"></textarea></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="addMember()">추가</button></div>`);
};

// 이름/별명이 다른 회원과 겹치면 입력할 때 누구인지 헷갈리므로 저장 전에 한 번 확인
function confirmNameAndAliases(name, aliases, selfId) {
  const k = normName(name);
  const sameName = members.find(m => m.id !== selfId && normName(m.name) === k);
  if (sameName && !confirm(`이미 "${sameName.name}" 회원이 있어요. 같은 이름으로 저장할까요?`)) return false;
  const aliasOwner = members.find(m => m.id !== selfId && memberAliases(m).some(a => normName(a) === k));
  if (aliasOwner && !confirm(`"${name}"은(는) ${aliasOwner.name} 회원의 별명이에요. 그래도 이 이름으로 저장할까요?`)) return false;
  const conflicts = findAliasConflicts(aliases, selfId);
  if (conflicts.length && !confirm(`다른 회원과 겹치는 별명이 있어요.\n${conflicts.join('\n')}\n\n그래도 저장할까요? (겹치는 별명으로 입력하면 누구인지 직접 골라야 해요)`)) return false;
  return true;
}

window.addMember = async function() {
  const name = document.getElementById('m-name').value.trim();
  const joinDate = document.getElementById('m-join').value;
  if (!name || !joinDate) { alert('이름과 가입일을 입력해주세요.'); return; }
  const aliases = parseAliasInput(document.getElementById('m-aliases').value, name);
  if (!confirmNameAndAliases(name, aliases, null)) return;
  const memo = document.getElementById('m-memo').value.trim();
  const numId = nextMemberId++;
  await addDoc(collection(db, 'members'), {numId, name, aliases, joinDate, lastAttend: null, contacted: false, memo});
  closeModal();
  toast(`${name} 회원을 추가했어요`);
};

window.openEditMember = function(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  openModal(`<div class="modal-title"><i class="ti ti-edit" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>회원 수정 — ${esc(m.name)}</div>
    <div class="form-row"><div class="form-group"><label>이름</label><input type="text" id="e-name" value="${esc(m.name)}"></div><div class="form-group"><label>가입일</label><input type="date" id="e-join" value="${esc(m.joinDate)}"></div></div>
    <div class="form-group"><label>별명</label><input type="text" id="e-aliases" value="${esc(memberAliases(m).join(', '))}" placeholder="예: 의석, uiseok — 쉼표로 여러 개"><div class="settle-hint">${ALIAS_HINT}</div></div>
    <div class="form-group"><label>최근 참여일</label><input type="date" id="e-attend" value="${esc(m.lastAttend||'')}"></div>
    <div class="form-group"><label>생일 (선택)</label><input type="date" id="e-birthday" value="${esc(m.birthday||'')}"></div>
    <div class="form-group"><label>메모</label><textarea id="e-memo">${esc(m.memo||'')}</textarea></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="editMember('${id}')">저장</button></div>`);
};

window.editMember = async function(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  const name = document.getElementById('e-name').value.trim() || m.name;
  const aliases = parseAliasInput(document.getElementById('e-aliases').value, name);
  if (!confirmNameAndAliases(name, aliases, id)) return;
  await updateDoc(doc(db, 'members', id), {
    name, aliases,
    joinDate: document.getElementById('e-join').value || m.joinDate,
    lastAttend: document.getElementById('e-attend').value || null,
    birthday: document.getElementById('e-birthday').value || null,
    memo: document.getElementById('e-memo').value.trim(),
  });
  closeModal();
  toast('회원 정보를 저장했어요');
};

// 회원 명단의 "별명" 칸에서 바로 여는 간단 편집창
window.openEditAliases = function(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  openModal(`<div class="modal-title"><i class="ti ti-tags" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>별명 — ${esc(m.name)}</div>
    <div class="form-group"><label>별명 (쉼표로 여러 개)</label><input type="text" id="alias-input" value="${esc(memberAliases(m).join(', '))}" placeholder="예: 의석, uiseok" autofocus onkeydown="onEnterKey(event, () => saveAliases(${jsArg(id)}))"><div class="settle-hint">${ALIAS_HINT}</div></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="saveAliases(${jsArg(id)})">저장</button></div>`);
};

window.saveAliases = async function(id) {
  const m = members.find(x => x.id === id);
  const input = document.getElementById('alias-input');
  if (!m || !input) return;
  const aliases = parseAliasInput(input.value, m.name);
  const conflicts = findAliasConflicts(aliases, id);
  if (conflicts.length && !confirm(`다른 회원과 겹치는 별명이 있어요.\n${conflicts.join('\n')}\n\n그래도 저장할까요?`)) return;
  await updateDoc(doc(db, 'members', id), {aliases});
  closeModal();
  toast(aliases.length ? `${m.name}: ${aliases.join(', ')}` : `${m.name} 별명을 비웠어요`);
};

// 전체 회원 별명을 한 화면에서 몰아서 입력
window.openAliasManager = function() {
  if (!isAdmin) return;
  const list = sortMembersByName(members);
  openModal(`<div class="modal-title"><i class="ti ti-tags" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>별명 관리</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.6">${ALIAS_HINT}<br>쉼표로 여러 개를 넣을 수 있어요. (예: 고의석 → <span class="alias-chip">의석</span><span class="alias-chip">uiseok</span>)</div>
    <input type="search" placeholder="회원 찾기" oninput="filterAliasManager(this.value)" style="margin-bottom:10px">
    <div id="alias-manager-list" style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow-y:auto;margin-bottom:14px;padding-right:2px">
      ${list.map(m => `<label class="alias-row" data-search="${esc(memberKeys(m).join(' '))}" style="display:flex;align-items:center;gap:10px">
        <span style="font-size:13px;font-weight:500;min-width:84px;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name)}</span>
        <input type="text" class="alias-manager-input" data-id="${m.id}" value="${esc(memberAliases(m).join(', '))}" placeholder="별명 없음" style="flex:1;min-width:0">
      </label>`).join('')}
    </div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">닫기</button><button class="btn btn-primary" onclick="saveAliasManager()">저장</button></div>`, 'lg');
};

window.filterAliasManager = function(q) {
  const key = normName(q);
  document.querySelectorAll('#alias-manager-list .alias-row').forEach(row => {
    row.classList.toggle('is-hidden', !!key && !(row.dataset.search || '').includes(key));
  });
};

window.saveAliasManager = async function() {
  const changes = [];
  document.querySelectorAll('.alias-manager-input').forEach(input => {
    const m = members.find(x => x.id === input.dataset.id);
    if (!m) return;
    const aliases = parseAliasInput(input.value, m.name);
    if (aliases.join('\u0000') !== memberAliases(m).join('\u0000')) changes.push({m, aliases});
  });
  if (changes.length === 0) { closeModal(); return; }
  // 저장 후의 상태 기준으로 겹치는 별명 확인
  const next = members.map(m => ({...m, aliases: (changes.find(c => c.m.id === m.id) || {}).aliases || memberAliases(m)}));
  const conflicts = [];
  changes.forEach(({m, aliases}) => aliases.forEach(a => {
    const k = normName(a);
    next.forEach(o => { if (o.id !== m.id && memberKeys(o).includes(k)) conflicts.push(`"${a}" (${m.name}) ↔ ${o.name}`); });
  }));
  if (conflicts.length && !confirm(`겹치는 별명이 있어요.\n${[...new Set(conflicts)].join('\n')}\n\n그래도 저장할까요?`)) return;
  for (const {m, aliases} of changes) await updateDoc(doc(db, 'members', m.id), {aliases});
  closeModal();
  toast(`${changes.length}명의 별명을 저장했어요`);
};

window.deleteMember = async function(id) {
  const m = members.find(x => x.id === id);
  if (!m || !confirm(`"${m.name}" 회원을 삭제할까요?`)) return;
  await deleteDoc(doc(db, 'members', id));
  for (const b of bungs) {
    if (b.attendees && b.attendees.includes(id)) {
      await updateDoc(doc(db, 'bungs', b.id), {
        attendees: b.attendees.filter(a => a !== id),
        ...(b.hostId === id ? {hostId: null} : {})
      });
    }
  }
  toast(`${m.name} 회원을 삭제했어요`, 'info');
};

window.toggleContact = async function(id, val) {
  await updateDoc(doc(db, 'members', id), {contacted: val});
};

// ── 프로필 연동 (계정 ↔ 회원 매칭) ──────────────────────────────────
function getMyMember() {
  if (!currentUser) return null;
  return members.find(m => m.linkedUid === currentUser.uid) || null;
}

function checkProfileLink() {
  if (!currentUser) return;
  // 이미 다른 팝업을 보고 있으면 그 위에 덮어쓰지 않음
  if (document.getElementById('modal-backdrop').classList.contains('open')) return;
  const me = getMyMember();
  if (me) return;
  const pending = members.find(m => m.linkPendingUid === currentUser.uid);
  if (pending) return;
  openLinkProfileModal();
}

window.openLinkProfileModal = function() {
  if (!currentUser) return requireLogin('프로필 연결은 로그인 후 이용할 수 있습니다.');
  if (getMyMember()) { alert('이미 프로필이 연결되어 있습니다.'); return; }
  const unlinked = members.filter(m => !m.linkedUid && !m.linkPendingUid);
  openModal(`<div class="modal-title"><i class="ti ti-user-circle" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>내 프로필 연결</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:14px;line-height:1.7">${isAdmin?'명단에서 본인 이름을 선택해주세요. 운영진 계정은 즉시 연결됩니다.':'처음 로그인하셨네요! 명단에서 본인 이름을 선택해주세요.<br>운영진 확인 후 연결이 확정됩니다.'}</div>
    <div class="form-group"><label>본인 이름 선택</label>
      <select id="link-member-select"><option value="">선택하세요</option>
      ${sortMembersByName(unlinked).map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}
      </select>
    </div>
    ${unlinked.length===0?'<div class="alert alert-info" style="margin-bottom:12px">연결 가능한 명단이 없습니다. 운영진에게 문의해주세요.</div>':''}
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">나중에</button><button class="btn btn-primary" onclick="requestProfileLink()">${isAdmin?'바로 연결':'연결 요청'}</button></div>`);
};

window.requestProfileLink = async function() {
  const id = document.getElementById('link-member-select').value;
  if (!id) { alert('이름을 선택해주세요.'); return; }
  if (isAdmin) {
    await updateDoc(doc(db, 'members', id), { linkedUid: currentUser.uid });
    closeModal();
    toast('프로필이 연결되었어요');
    return;
  }
  await updateDoc(doc(db, 'members', id), {
    linkPendingUid: currentUser.uid,
    linkPendingEmail: currentUser.email,
    linkPendingName: currentUser.displayName || currentUser.email,
  });
  closeModal();
  toast('연결 요청을 보냈어요. 운영진 확인 후 적용돼요.', 'info');
};

window.approveProfileLink = async function(id) {
  const m = members.find(x => x.id === id);
  if (!m || !m.linkPendingUid) return;
  if (!confirm(`"${m.name}" 회원을 ${m.linkPendingName}(${m.linkPendingEmail}) 계정과 연결할까요?`)) return;
  await updateDoc(doc(db, 'members', id), {
    linkedUid: m.linkPendingUid,
    linkPendingUid: null, linkPendingEmail: null, linkPendingName: null,
  });
};

window.rejectProfileLink = async function(id) {
  const m = members.find(x => x.id === id);
  if (!m || !confirm('연결 요청을 거부할까요?')) return;
  await updateDoc(doc(db, 'members', id), {linkPendingUid: null, linkPendingEmail: null, linkPendingName: null});
};

window.unlinkProfile = async function(id) {
  const m = members.find(x => x.id === id);
  if (!m || !confirm(`"${m.name}" 회원의 계정 연결을 해제할까요?`)) return;
  await updateDoc(doc(db, 'members', id), {linkedUid: null});
};

// ── 역할 부여 (운영진/모임장) ────────────────────────────────────
window.openSetRole = function(id) {
  if (!isAdmin) return;
  const m = members.find(x => x.id === id);
  if (!m) return;
  openModal(`<div class="modal-title"><i class="ti ti-crown" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>역할 지정 — ${esc(m.name)}</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:14px;line-height:1.7">운영진과 모임장은 동일한 관리 권한을 가집니다. 역할을 가진 회원은 계정 연결 시 자동으로 운영진 권한이 부여됩니다.</div>
    <div class="form-group"><label>역할</label>
      <select id="role-select">
        <option value="" ${!m.role?'selected':''}>일반 회원</option>
        <option value="admin" ${m.role==='admin'?'selected':''}>운영진</option>
        <option value="host" ${m.role==='host'?'selected':''}>모임장</option>
      </select>
    </div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="saveRole('${id}')">저장</button></div>`);
};

window.saveRole = async function(id) {
  if (!isAdmin) return;
  const role = document.getElementById('role-select').value || null;
  await updateDoc(doc(db, 'members', id), {role});
  closeModal();
  toast('역할을 저장했어요');
};

// ── 프로필 커스텀 (본인만 수정 가능) ────────────────────────────────
window.openEditMyProfile = function(id) {
  const m = members.find(x => x.id === id);
  if (!m || !currentUser || m.linkedUid !== currentUser.uid) { alert('본인 프로필만 수정할 수 있습니다.'); return; }
  openModal(`<div class="modal-title"><i class="ti ti-user-circle" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>내 프로필 수정</div>
    <div class="form-group"><label>닉네임</label><input type="text" id="mp-name" value="${esc(m.name)}"></div>
    <div class="form-group"><label>프로필 사진</label>
      <div class="flex" style="gap:10px;align-items:center">
        ${m.photoURL?`<img src="${esc(m.photoURL)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover">`:''}
        <input type="file" id="mp-photo" accept="image/*" style="flex:1">
      </div>
    </div>
    <div class="form-group"><label>한줄소개</label><input type="text" id="mp-bio" value="${esc(m.bio||'')}" placeholder="나를 소개해보세요" maxlength="60"></div>
    <div class="form-row">
      <div class="form-group"><label>최애 아티스트</label><input type="text" id="mp-artist" value="${esc(m.favArtist||'')}" placeholder="예: 요네즈 켄시"></div>
      <div class="form-group"><label>최애곡</label><input type="text" id="mp-song" value="${esc(m.favSong||'')}" placeholder="예: Lemon"></div>
    </div>
    <div class="form-group"><label>생일 (선택)</label><input type="date" id="mp-birthday" value="${esc(m.birthday||'')}"></div>
    <div id="mp-status" style="font-size:12px;color:var(--text2);margin-bottom:8px"></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="saveMyProfile('${id}')">저장</button></div>`);
};

window.saveMyProfile = async function(id) {
  const m = members.find(x => x.id === id);
  if (!m || !currentUser || m.linkedUid !== currentUser.uid) return;
  const name = document.getElementById('mp-name').value.trim();
  if (!name) { alert('닉네임을 입력해주세요.'); return; }
  const bio = document.getElementById('mp-bio').value.trim();
  const favArtist = document.getElementById('mp-artist').value.trim();
  const favSong = document.getElementById('mp-song').value.trim();
  const birthday = document.getElementById('mp-birthday').value || null;
  const file = document.getElementById('mp-photo').files[0];
  const statusEl = document.getElementById('mp-status');
  const updates = {name, bio, favArtist, favSong, birthday};
  try {
    if (file) {
      statusEl.textContent = '사진 업로드 중...';
      const storageRef = ref(storage, `profiles/${id}_${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      updates.photoURL = await getDownloadURL(storageRef);
    }
    await updateDoc(doc(db, 'members', id), updates);
    closeModal();
    toast('프로필을 저장했어요');
  } catch(e) {
    statusEl.textContent = '저장 실패: ' + e.message;
  }
};

// ── 벙 CRUD ───────────────────────────────────────────────────────
// 참석자 선택기: 체크박스 목록과 위쪽 태그(선택한 순서)를 attendeeOrder로 동기화한다.
const attendeeOrder = {add: [], edit: []};

function memberSelectHTML(mode, checkedIds=[]) {
  attendeeOrder[mode] = checkedIds.filter(id => members.some(m => m.id === id));
  return `<div style="display:flex;gap:6px;margin-bottom:6px">
    <input type="text" id="member-search${mode==='edit'?'-edit':''}" placeholder="이름·별명 입력 후 엔터 (쉼표로 여러 명)" autocomplete="off" style="flex:1;min-width:0" oninput="onAttendeeQuery('${mode}')" onkeydown="handleAttendeeInput(event,'${mode}')">
    <button class="btn btn-sm" onclick="handleAttendeeAdd('${mode}')" type="button" style="flex-shrink:0">추가</button>
  </div>
  <div class="picker-msg" id="${mode}-picker-msg"></div>
  <div id="${mode}-tag-area" class="tag-area">${attendeeTagsHTML(mode)}</div>
  <div class="attendee-scroll" id="${mode}-attendee-list">${sortMembersByName(members).map(m => {
    const aliases = memberAliases(m);
    return `<label class="attendee-label" data-id="${m.id}" data-search="${esc(memberKeys(m).join('|'))}"><input type="checkbox" class="attend-check" value="${m.id}" ${checkedIds.includes(m.id)?'checked':''} onchange="onAttendeeCheck('${mode}',this)"> ${esc(m.name)}${aliases.length?` <span class="alias-hint">${esc(aliases.join(', '))}</span>`:''}</label>`;
  }).join('')}</div>`;
}

function defaultBungName(dateStr, type) {
  const d = parseDateStr(dateStr);
  return isNaN(d) ? type : `${d.getMonth()+1}월 ${d.getDate()}일 ${type}`;
}
// 예전에 입력했던 장소·시간·주제를 자동완성 후보로 제공 (최근 것부터)
function recentBungValues(field) {
  const seen = new Set(), out = [];
  [...bungs].sort((a,b) => (b.date||'').localeCompare(a.date||'')).forEach(b => {
    const v = (b[field]||'').trim();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  });
  return out.slice(0, 20);
}
function bungDatalistsHTML() {
  return ['place','time','topic'].map(f => `<datalist id="bung-${f}-list">${recentBungValues(f).map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist>`).join('');
}
window.updateBungNamePlaceholder = function() {
  const nameEl = document.getElementById('b-name');
  if (nameEl) nameEl.placeholder = defaultBungName(document.getElementById('b-date').value, document.getElementById('b-type').value);
};

window.openAddBung = function(presetDate) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(presetDate || '') ? presetDate : todayStr();
  openModal(`<div class="modal-title"><i class="ti ti-calendar-plus" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>벙 추가</div>
    <div class="form-row"><div class="form-group"><label>벙 이름</label><input type="text" id="b-name" placeholder="${esc(defaultBungName(date, '번개'))}" autofocus></div><div class="form-group"><label>날짜</label><input type="date" id="b-date" value="${date}" onchange="updateBungNamePlaceholder()"></div></div>
    <div class="settle-hint" style="margin:-6px 0 12px">이름을 비워두면 날짜·구분으로 자동으로 지어져요. (예: ${esc(defaultBungName(date, '번개'))})</div>
    <div class="form-row"><div class="form-group"><label>구분</label><select id="b-type" onchange="updateBungNamePlaceholder()"><option value="번개" selected>번개</option><option value="정모">정모</option></select></div><div class="form-group"><label>장소</label><input type="text" id="b-place" placeholder="홍대 코인노래방" list="bung-place-list" autocomplete="off"></div></div>
    <div class="form-row"><div class="form-group"><label>시간</label><input type="text" id="b-time" placeholder="오후 7시 30분" list="bung-time-list" autocomplete="off"></div><div class="form-group"><label>주제</label><input type="text" id="b-topic" placeholder="노래방" list="bung-topic-list" autocomplete="off"></div></div>
    <div class="form-group"><label>참석자 선택</label>${memberSelectHTML('add')}</div>
    <div class="form-group"><label>벙주 (참석자 중 선택)</label><select id="b-host"><option value="">선택 안 함</option></select></div>
    <div class="form-group"><label>메모</label><textarea id="b-memo" placeholder="후기 등"></textarea></div>
    ${bungDatalistsHTML()}
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="addBung()">추가</button></div>`);
  updateHostSelect('add');
};

window.addBung = async function() {
  const date = document.getElementById('b-date').value;
  const type = document.getElementById('b-type').value;
  const name = document.getElementById('b-name').value.trim() || defaultBungName(date, type);
  if (!date) { alert('날짜를 입력해주세요.'); return; }
  const attendees = [...attendeeOrder.add];
  const hostVal = document.getElementById('b-host').value;
  const numId = nextBungId++;
  await addDoc(collection(db, 'bungs'), {
    numId, date, name, attendees,
    type,
    place: document.getElementById('b-place').value.trim(),
    time: document.getElementById('b-time').value.trim(),
    topic: document.getElementById('b-topic').value.trim(),
    hostId: hostVal || null,
    memo: document.getElementById('b-memo').value.trim(),
    createdAt: serverTimestamp(),
  });
  for (const id of attendees) {
    const m = members.find(x => x.id === id);
    if (m) {
      // 부활 업적: 참석 등록 직전 유령 대상/경고 상태였다면 영구 플래그로 기록
      const prevStatus = getMemberStatus(m, TODAY);
      const wasGhostish = (prevStatus === 'ghost' || prevStatus === 'contacted');
      const cur = m.lastAttend ? new Date(m.lastAttend) : null;
      const d = new Date(date);
      const updates = {};
      if (!cur || d > cur) updates.lastAttend = date;
      if (wasGhostish && !m.revivedFromGhost) updates.revivedFromGhost = true;
      if (Object.keys(updates).length > 0) await updateDoc(doc(db, 'members', id), updates);
    }
  }
  closeModal();
  toast(`"${name}" 벙을 추가했어요${attendees.length ? ` · 참석 ${attendees.length}명` : ''}`);
};

window.openEditBung = function(id) {
  const b = bungs.find(x => x.id === id);
  if (!b) return;
  openModal(`<div class="modal-title"><i class="ti ti-edit" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>벙 수정 — ${esc(b.name)}</div>
    <div class="form-row"><div class="form-group"><label>벙 이름</label><input type="text" id="eb-name" value="${esc(b.name)}"></div><div class="form-group"><label>날짜</label><input type="date" id="eb-date" value="${esc(b.date)}"></div></div>
    <div class="form-row"><div class="form-group"><label>구분</label><select id="eb-type"><option value="번개" ${b.type==='번개'?'selected':''}>번개</option><option value="정모" ${b.type==='정모'?'selected':''}>정모</option></select></div><div class="form-group"><label>장소</label><input type="text" id="eb-place" value="${esc(b.place||'')}" list="bung-place-list" autocomplete="off"></div></div>
    <div class="form-row"><div class="form-group"><label>시간</label><input type="text" id="eb-time" value="${esc(b.time||'')}" list="bung-time-list" autocomplete="off"></div><div class="form-group"><label>주제</label><input type="text" id="eb-topic" value="${esc(b.topic||'')}" list="bung-topic-list" autocomplete="off"></div></div>
    <div class="form-group"><label>참석자 선택</label>${memberSelectHTML('edit', b.attendees||[])}</div>
    <div class="form-group"><label>벙주 (참석자 중 선택)</label><select id="eb-host"><option value="">선택 안 함</option>${(b.attendees||[]).map(aid=>{const m=members.find(x=>x.id===aid);return m?`<option value="${m.id}" ${b.hostId===m.id?'selected':''}>${esc(m.name)}</option>`:''}).join('')}</select></div>
    <div class="form-group"><label>메모</label><textarea id="eb-memo">${esc(b.memo||'')}</textarea></div>
    ${bungDatalistsHTML()}
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="editBung('${id}')">저장</button></div>`);
};

window.editBung = async function(id) {
  const b = bungs.find(x => x.id === id);
  if (!b) return;
  const attendees = [...attendeeOrder.edit];
  const hostVal = document.getElementById('eb-host').value;
  const newDate = document.getElementById('eb-date').value || b.date;
  await updateDoc(doc(db, 'bungs', id), {
    name: document.getElementById('eb-name').value.trim() || b.name,
    date: newDate,
    type: document.getElementById('eb-type').value,
    place: document.getElementById('eb-place').value.trim(),
    time: document.getElementById('eb-time').value.trim(),
    topic: document.getElementById('eb-topic').value.trim(),
    hostId: hostVal || null,
    attendees,
    memo: document.getElementById('eb-memo').value.trim(),
  });
  await recalcLastAttend();
  closeModal();
  toast('벙 정보를 저장했어요');
};

window.deleteBung = async function(id) {
  const b = bungs.find(x => x.id === id);
  if (!b || !confirm(`"${b.name}" 벙을 삭제할까요?`)) return;
  await deleteDoc(doc(db, 'bungs', id));
  await recalcLastAttend();
  toast(`"${b.name}" 벙을 삭제했어요`, 'info');
};

async function recalcLastAttend() {
  for (const m of members) {
    let last = null;
    bungs.forEach(b => {
      if ((b.attendees||[]).includes(m.id) && b.date && (!last || b.date > last)) last = b.date;
    });
    const newLast = last || null;
    const updates = {};
    if (newLast !== m.lastAttend) updates.lastAttend = newLast;
    // 부활 업적: 참여일이 "더 최근으로" 갱신되는데 그 시점 상태가 유령/경고였다면 기록
    // (참석자에서 빠져서 참여일이 앞당겨지는 경우는 부활이 아님)
    if (updates.lastAttend && (!m.lastAttend || updates.lastAttend > m.lastAttend)) {
      const prevStatus = getMemberStatus(m, TODAY);
      if ((prevStatus === 'ghost' || prevStatus === 'contacted') && !m.revivedFromGhost) updates.revivedFromGhost = true;
    }
    if (Object.keys(updates).length > 0) await updateDoc(doc(db, 'members', m.id), updates);
  }
}

// ── 갤러리 ────────────────────────────────────────────────────────
let galleryFiles = [];
window.loadGallery = async function() {
  const el = document.getElementById('gallery-grid');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text2);font-size:13px">불러오는 중...</div>';
  try {
    const listRef = ref(storage, 'gallery/');
    const res = await listAll(listRef);
    galleryFiles = await Promise.all(res.items.map(async item => ({
      ref: item, name: item.name,
      url: await getDownloadURL(item)
    })));
    galleryFiles.reverse();
    renderGallery();
  } catch(e) {
    el.innerHTML = '<div style="color:var(--text2);font-size:13px">갤러리 불러오기 실패</div>';
  }
};

function renderGallery() {
  const el = document.getElementById('gallery-grid');
  if (!el) return;
  if (galleryFiles.length === 0) {
    el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="ti ti-photo-off"></i>사진이 없습니다.</div>';
    return;
  }
  el.innerHTML = galleryFiles.map((f,i) => `
    <div class="gallery-tile" style="position:relative;aspect-ratio:1;overflow:hidden;border-radius:var(--radius-lg);background:var(--bg2);border:0.5px solid var(--border);cursor:pointer" onclick="openLightbox(${i})">
      <img src="${esc(f.url)}" style="width:100%;height:100%;object-fit:cover" loading="lazy" alt="${esc(f.name)}">
      ${isAdmin ? `<button onclick="event.stopPropagation();deletePhoto(${i})" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.55);color:#fff;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px" class="del-btn edit-only"><i class="ti ti-x"></i></button>` : ''}
    </div>`).join('');
}

// 사진 크게 보기: ← → 키 / 좌우 버튼 / 스와이프로 넘기기, Esc나 바깥 클릭으로 닫기
let lightboxIdx = 0;
window.closeLightbox = function() {
  const lb = document.getElementById('kiku-lightbox');
  if (!lb) return;
  lb.style.opacity = '0';
  setTimeout(() => lb.remove(), 180);
};
window.stepLightbox = function(dir) {
  if (galleryFiles.length === 0) return;
  lightboxIdx = (lightboxIdx + dir + galleryFiles.length) % galleryFiles.length;
  const img = document.getElementById('kiku-lightbox-img');
  const counter = document.getElementById('kiku-lightbox-count');
  if (img) { img.style.opacity = '0'; setTimeout(() => { img.src = galleryFiles[lightboxIdx].url; img.style.opacity = '1'; }, 120); }
  if (counter) counter.textContent = `${lightboxIdx + 1} / ${galleryFiles.length}`;
};
window.openLightbox = function(idx) {
  const existing = document.getElementById('kiku-lightbox');
  if (existing) existing.remove();
  lightboxIdx = idx;
  const lb = document.createElement('div');
  lb.id = 'kiku-lightbox';
  lb.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:300;display:flex;align-items:center;justify-content:center;padding:1rem;animation:kk-fade-in .2s ease both;transition:opacity .18s ease';
  const navBtn = 'position:absolute;top:50%;transform:translateY(-50%);color:#fff;font-size:26px;cursor:pointer;background:rgba(255,255,255,0.12);border:none;border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center';
  lb.innerHTML = `<button onclick="closeLightbox()" aria-label="닫기" style="position:absolute;top:1rem;right:1rem;color:#fff;font-size:24px;cursor:pointer;background:none;border:none"><i class="ti ti-x"></i></button>
    ${galleryFiles.length > 1 ? `<button onclick="stepLightbox(-1)" aria-label="이전 사진" style="${navBtn};left:1rem"><i class="ti ti-chevron-left"></i></button>
    <button onclick="stepLightbox(1)" aria-label="다음 사진" style="${navBtn};right:1rem"><i class="ti ti-chevron-right"></i></button>
    <div id="kiku-lightbox-count" style="position:absolute;bottom:1rem;left:0;right:0;text-align:center;color:rgba(255,255,255,.75);font-size:12px">${idx + 1} / ${galleryFiles.length}</div>` : ''}
    <img id="kiku-lightbox-img" src="${esc(galleryFiles[idx].url)}" style="max-width:100%;max-height:90vh;object-fit:contain;border-radius:var(--radius);transition:opacity .12s ease;animation:kk-modal-in .25s ease both" alt="">`;
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
  let touchX = null;
  lb.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, {passive: true});
  lb.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
    touchX = null;
  });
  document.body.appendChild(lb);
};

window.uploadPhotos = async function(event) {
  const files = [...event.target.files];
  if (!files.length) return;
  const statusEl = document.getElementById('gallery-status');
  const statusText = document.getElementById('gallery-status-text');
  const input = event.target;
  statusEl.style.display = 'flex';
  let done = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      statusText.textContent = `업로드 중... (${i+1}/${files.length}) ${files[i].name}`;
      const storageRef = ref(storage, `gallery/${Date.now()}_${files[i].name}`);
      await uploadBytes(storageRef, files[i]);
      done++;
    }
    statusText.textContent = '업로드 완료!';
    toast(`사진 ${done}장을 올렸어요`);
  } catch(e) {
    statusText.textContent = `업로드 실패 (${done}/${files.length}장 완료): ${e.message}`;
    toast('사진 업로드에 실패했어요', 'error');
  } finally {
    setTimeout(() => { statusEl.style.display = 'none'; }, 2500);
    input.value = '';
    await loadGallery();
  }
};

window.deletePhoto = async function(idx) {
  if (!confirm(`사진을 삭제할까요?`)) return;
  await deleteObject(galleryFiles[idx].ref);
  galleryFiles.splice(idx, 1);
  renderGallery();
  toast('사진을 삭제했어요', 'info');
};
// ── 유틸 ──────────────────────────────────────────────────────────
function getCalcDate() {
  const m = TODAY.getMonth()+1, y = TODAY.getFullYear();
  if (m%2===0 && TODAY.getDate()===1) return new Date(y, m-1, 1);
  const ne = m%2===0 ? m+2 : m+1;
  if (ne > 12) return new Date(y+1, 1, 1);
  return new Date(y, ne-1, 1);
}
function isCalcDay() {
  const cd = getCalcDate();
  return TODAY.getDate()===cd.getDate() && TODAY.getMonth()===cd.getMonth() && TODAY.getFullYear()===cd.getFullYear();
}
// 유령 정리 탭 전용 기산일 탐색: offset 0 = 이번(가장 최근에 도래한) 정리 주기,
// offset -1 = 다음 정리 예정(미리보기), offset 1,2,3... = 그 이전 지난 주기들.
// getCalcDate()와 달리 기산일이 지나도 "이번 주기"가 미래로 튀지 않아 지난 주기 조회가 가능하다.
function getGhostCycleDate(offset) {
  const y = TODAY.getFullYear(), m = TODAY.getMonth()+1;
  const baseEvenMonth = m%2===0 ? m : m-1;
  const idx = (y*12 + (baseEvenMonth-1)) - offset*2;
  return new Date(Math.floor(idx/12), ((idx%12)+12)%12, 1);
}
function getGhostCycleOptions() {
  const opts = [{offset:-1, label:`다음 정리 예정 — ${formatDate(getGhostCycleDate(-1))} (미리보기)`}];
  for (let i=0;i<=11;i++) {
    opts.push({offset:i, label:(i===0?'이번 정리 — ':'지난 정리 — ')+formatDate(getGhostCycleDate(i))});
  }
  return opts;
}
let ghostSelectedOffset = null; // null = 아직 직접 고르지 않음 → 진행 상태에 맞는 기본값 사용

// ── 유령 정리 진행 상태 ──
// 기산일이 지난 뒤 이번 정리를 마치면(초기화 실행 또는 "이미 정리했어요") 그 기산일을 "완료"로 기록한다.
//  · 완료 전: 대시보드·회원 명단·유령 정리 탭 모두 "이번 기산일" 기준 (지금 정리해야 할 대상)
//  · 완료 후: "다음 기산일" 기준 미리보기 (다음 정리 때 위험한 회원)
// 예전에는 기산일 다음 날부터 바로 다음 기산일 기준으로 바뀌어서, 지난주에 온 회원까지 모두 "유령 대상"으로 보였음.
let ghostDoneCycle = (() => { try { return localStorage.getItem('kiku-ghost-done') || null; } catch(e) { return null; } })();
function rememberGhostDoneCycle(v) {
  if (!v || (ghostDoneCycle && ghostDoneCycle >= v)) return false;
  ghostDoneCycle = v;
  try { localStorage.setItem('kiku-ghost-done', v); } catch(e) {}
  return true;
}
function isCurrentCycleDone() {
  return !!ghostDoneCycle && ghostDoneCycle >= toDateStr(getGhostCycleDate(0));
}
// 앱 전체에서 회원 상태(정상/신규/유령)를 판단하는 기준 기산일
function getStatusCycle() {
  return isCurrentCycleDone() ? {date: getGhostCycleDate(-1), preview: true} : {date: getGhostCycleDate(0), preview: false};
}
function resolvedGhostOffset() {
  if (ghostSelectedOffset === null) return isCurrentCycleDone() ? -1 : 0;
  return ghostSelectedOffset;
}
function shortDate(d) { return `${d.getMonth()+1}.${String(d.getDate()).padStart(2,'0')}`; }
function getYoutubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function formatDate(d) {
  if (!d) return '-';
  const dt = typeof d==='string' ? (/^\d{4}-\d{2}-\d{2}$/.test(d) ? parseDateStr(d) : new Date(d)) : d;
  if (isNaN(dt)) return '-';
  return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`;
}
function daysBetween(a, b) { return Math.floor((b-a)/(1000*60*60*24)); }

function getMemberStatus(m, calcDate) {
  const join = new Date(m.joinDate);
  const twoMonthsBefore = new Date(calcDate);
  twoMonthsBefore.setMonth(twoMonthsBefore.getMonth()-2);
  if (join > twoMonthsBefore) return 'new';
  const lastA = m.lastAttend ? new Date(m.lastAttend) : null;
  const twoMonthsAgo = new Date(calcDate);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth()-2);
  if (lastA && lastA >= twoMonthsAgo) return 'safe';
  if (m.contacted) return 'contacted';
  return 'ghost';
}

function getMemberGrade(rate) {
  if (rate >= 60) return {label:'⭐ 우수', color:'var(--success)', bg:'var(--success-bg)'};
  if (rate >= 20) return {label:'✅ 활동', color:'var(--info)', bg:'var(--info-bg)'};
  return {label:'👤 일반', color:'var(--text2)', bg:'var(--bg2)'};
}

function getMemberStats() {
  const totalBungs = bungs.length;
  return members.map(m => {
    const attended = bungs.filter(b => (b.attendees||[]).includes(m.id)).length;
    const rate = totalBungs > 0 ? Math.round(attended/totalBungs*100) : 0;
    const grade = getMemberGrade(rate);
    return {...m, attended, rate, grade};
  }).sort((a,b) => b.rate-a.rate || b.attended-a.attended);
}

// 통계 탭의 "최근 2개월" = 오늘 기준 2개월 전 ~ 오늘.
// (예전에는 다음 기산일 기준으로 잘라서, 기산일 직후엔 기간이 며칠뿐이라 통계가 거의 비어 보였음)
function recentWindowStartStr() { const d = new Date(TODAY); d.setMonth(d.getMonth()-2); return toDateStr(d); }
function getRecentBungs() {
  const from = recentWindowStartStr(), to = todayStr();
  return bungs.filter(b => b.date && b.date >= from && b.date <= to);
}

function getRecentMemberStats() {
  const recentBungs = getRecentBungs();
  const totalBungs = recentBungs.length;
  return members.map(m => {
    const attended = recentBungs.filter(b => (b.attendees||[]).includes(m.id)).length;
    const rate = totalBungs > 0 ? Math.round(attended/totalBungs*100) : 0;
    const grade = getMemberGrade(rate);
    return {...m, attended, rate, grade};
  }).sort((a,b) => b.rate-a.rate || b.attended-a.attended);
}

function getAchievements(m) {
  const attended = bungs.filter(b => (b.attendees||[]).includes(m.id));
  const jeongmoAttended = bungs.filter(b => (b.attendees||[]).includes(m.id) && b.type==='정모');
  const hostedBungs = bungs.filter(b => b.hostId===m.id);
  const joinDate = new Date(m.joinDate);
  const yearsDiff = (TODAY-joinDate)/(1000*60*60*24*365);
  const totalBungsCount = bungs.length;
  const rate = totalBungsCount > 0 ? attended.length/totalBungsCount*100 : 0;
  const sortedBungs = [...bungs].sort((a,b) => new Date(a.date)-new Date(b.date));
  let maxStreak=0, curStreak=0;
  sortedBungs.forEach(b => {
    if ((b.attendees||[]).includes(m.id)) { curStreak++; if (curStreak>maxStreak) maxStreak=curStreak; }
    else curStreak=0;
  });

  // ── 히든 업적 계산용 데이터 ──
  const myPosts = posts.filter(p => p.authorUid === m.linkedUid);
  const myPostDates = myPosts.map(p => p.createdAt ? new Date(p.createdAt.seconds*1000) : null).filter(Boolean);
  const lateNightCount = myPostDates.filter(d => d.getHours() >= 0 && d.getHours() < 5).length;
  const myBirthdayAttend = m.birthday ? attended.some(b => {
    const bd = new Date(b.date), birth = new Date(m.birthday);
    return bd.getMonth()===birth.getMonth() && bd.getDate()===birth.getDate();
  }) : false;
  const maxCommentCount = myPosts.length>0 ? Math.max(...myPosts.map(p=>p.commentCount||0)) : 0;
  const photoFullPosts = myPosts.filter(p => (p.images||[]).length>=4).length;
  const anonSuggestions = posts.filter(p => p.type==='suggestion' && p.anonymous && p.authorUid===m.linkedUid).length;
  const earlyMemberCutoff = bungs.length>0 ? new Date(Math.min(...bungs.map(b=>new Date(b.date)))) : null;
  let isFoundingMember = false;
  if (earlyMemberCutoff) {
    const cutoff = new Date(earlyMemberCutoff); cutoff.setMonth(cutoff.getMonth()+3);
    isFoundingMember = joinDate <= cutoff;
  }
  const mySongPosts = posts.filter(p => p.type==='song' && p.authorUid===m.linkedUid && p.songName);
  const songNameCounts = {};
  mySongPosts.forEach(p => { const key=(p.songName||'').trim().toLowerCase(); if(key) songNameCounts[key]=(songNameCounts[key]||0)+1; });
  const hasRepeatSong = Object.values(songNameCounts).some(c=>c>=2);

  const hidden = [
    {id:'h_dawn', icon:'🌙', label:'새벽의 전설', desc:'밤 12시~5시 사이 글/댓글 3회 이상 작성', unlocked: lateNightCount>=3, hidden:true},
    {id:'h_birthday', icon:'🎂', label:'생일 출석', desc:'본인 생일에 벙 참석', unlocked: myBirthdayAttend, hidden:true},
    {id:'h_revive', icon:'👻', label:'유령에서 부활', desc:'유령 판정 후 다시 돌아온 회원', unlocked: !!m.revivedFromGhost, hidden:true},
    {id:'h_feed', icon:'🗣️', label:'떡밥 제조기', desc:'내 글에 댓글 10개 이상 달림', unlocked: maxCommentCount>=10, hidden:true},
    {id:'h_photo', icon:'📸', label:'사진 부자', desc:'사진 4장 채운 글 3개 이상', unlocked: photoFullPosts>=3, hidden:true},
    {id:'h_anon', icon:'🤐', label:'익명의 건의자', desc:'건의사항 익명으로 3회 이상 작성', unlocked: anonSuggestions>=3, hidden:true},
    {id:'h_founder', icon:'🥇', label:'창립 멤버', desc:'소모임 초창기(첫 3개월 이내) 가입', unlocked: isFoundingMember, hidden:true},
    {id:'h_repeat', icon:'🔁', label:'돌고 돌아', desc:'같은 곡을 2번 이상 추천', unlocked: hasRepeatSong, hidden:true},
    {id:'h_allrounder', icon:'💌', label:'전방위 멤버', desc:'정모·번개 모두 참석 + 게시글 작성 + 벙주까지 모두 경험', unlocked: jeongmoAttended.length>=1 && attended.some(b=>b.type==='번개') && myPosts.length>=1 && hostedBungs.length>=1, hidden:true},
  ];

  return [
    {id:'first', icon:'🎤', label:'첫 발걸음', desc:'첫 벙 참석', unlocked:attended.length>=1},
    {id:'streak3', icon:'🔥', label:'3연속 개근', desc:'3번 연속 참석', unlocked:maxStreak>=3},
    {id:'host', icon:'👑', label:'벙주 데뷔', desc:'첫 벙주 담당', unlocked:hostedBungs.length>=1},
    {id:'attend10', icon:'🎯', label:'10회 참석', desc:'총 10회 참석', unlocked:attended.length>=10},
    {id:'master', icon:'💎', label:'개근왕', desc:'참여율 80% 이상', unlocked:rate>=80},
    {id:'anniv', icon:'🌟', label:'1주년 멤버', desc:'가입 1년 이상', unlocked:yearsDiff>=1},
    {id:'jeongmo5', icon:'🏆', label:'정모 마스터', desc:'정모 5회 이상 참석', unlocked:jeongmoAttended.length>=5},
    ...hidden,
  ];
}

function getGroupAchievements() {
  const totalAttend = bungs.reduce((s,b)=>s+(b.attendees||[]).length, 0);
  const hasJeongmo = bungs.some(b=>b.type==='정모');
  return [
    {icon:'🎉', label:'첫 정모 개최', unlocked:hasJeongmo},
    {icon:'🏟️', label:'총 10회 달성', unlocked:bungs.length>=10},
    {icon:'👥', label:'회원 20명 돌파', unlocked:members.length>=20},
    {icon:'🎵', label:'참석 100명 돌파', unlocked:totalAttend>=100},
  ];
}

// ── 시즌 업적 (매달 칭호, 한번 확정되면 명예의 전당에 영구 기록) ──────────
const SEASON_AWARD_DEFS = [
  {id:'pioneer', icon:'🥇', label:'이달의 선구자', desc:'이번 달 첫 곡 추천'},
  {id:'latecomer', icon:'🐢', label:'막차 탑승', desc:'벙 마감 직전 신청'},
  {id:'planner', icon:'📅', label:'이달의 기획자', desc:'이번 달 벙주 최다 담당'},
  {id:'hottrack', icon:'🎤', label:'이달의 핫트랙', desc:'이번 달 가장 많이 추천된 곡의 추천자'},
  {id:'chatty', icon:'💬', label:'이달의 수다왕', desc:'이번 달 게시글+댓글 합산 최다'},
  {id:'sprout', icon:'🌱', label:'이달의 새싹', desc:'이번 달 가입 후 가장 빨리 첫 벙 참석한 신규 회원'},
];

function ymKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

// 특정 연-월(ym) 동안의 시즌 업적 수상자를 계산. 데이터 부족 시 해당 항목은 null.
function calcSeasonAwardsForMonth(ym) {
  const monthPosts = posts.filter(p => {
    if (!p.createdAt) return false;
    const d = new Date(p.createdAt.seconds*1000);
    return ymKey(d) === ym;
  });
  const monthBungs = bungs.filter(b => b.date && b.date.startsWith(ym));
  const result = {};

  // 1. 이달의 선구자 — 이번 달 첫 곡 추천 게시물 작성자
  const songPosts = monthPosts.filter(p => p.type === 'song' && p.songName)
    .sort((a,b) => a.createdAt.seconds - b.createdAt.seconds);
  if (songPosts.length > 0) {
    const p = songPosts[0];
    result.pioneer = {uid: p.authorUid, name: p.anonymous ? '익명' : resolveAuthorName(p.authorUid, p.authorName)};
  }

  // 2. 막차 탑승 — 이번 달 벙 중 "공지일 ~ 벙 날짜" 간격이 가장 짧았던(=급하게 잡힌) 벙에 참석한 회원 중,
  //    평소 참여율이 가장 낮은 회원에게 부여 (급벙에도 와준 의외의 참석자라는 의미)
  const bungsWithCreatedAt = monthBungs.filter(b => b.createdAt);
  if (bungsWithCreatedAt.length > 0) {
    const shortest = [...bungsWithCreatedAt].sort((a,b) => {
      const gapA = new Date(a.date) - new Date(a.createdAt.seconds*1000);
      const gapB = new Date(b.date) - new Date(b.createdAt.seconds*1000);
      return gapA - gapB;
    })[0];
    const attendees = (shortest.attendees||[]);
    if (attendees.length > 0) {
      const totalBungsCount = bungs.length;
      const candidates = attendees.map(id => {
        const mm = members.find(x=>x.id===id);
        if (!mm) return null;
        const cnt = bungs.filter(b=>(b.attendees||[]).includes(id)).length;
        const rate = totalBungsCount>0 ? cnt/totalBungsCount : 0;
        return {id, name: mm.name, uid: mm.linkedUid, rate};
      }).filter(Boolean);
      if (candidates.length > 0) {
        candidates.sort((a,b)=>a.rate-b.rate);
        result.latecomer = {uid: candidates[0].uid, name: candidates[0].name};
      }
    }
  }

  // 3. 이달의 기획자 — 이번 달 벙주 최다 담당
  const hostCounts = {};
  monthBungs.forEach(b => { if (b.hostId) hostCounts[b.hostId] = (hostCounts[b.hostId]||0)+1; });
  const hostEntries = Object.entries(hostCounts).sort((a,b)=>b[1]-a[1]);
  if (hostEntries.length > 0 && hostEntries[0][1] >= 1) {
    const mm = members.find(x=>x.id===hostEntries[0][0]);
    if (mm) result.planner = {uid: mm.linkedUid, name: mm.name, count: hostEntries[0][1]};
  }

  // 4. 이달의 핫트랙 — 이번 달 가장 많이 등록된 곡(중복 추천 포함) 추천자 중 첫 추천자
  const songCounts = {};
  songPosts.forEach(p => { const key=(p.songName||'').trim().toLowerCase(); if(key) songCounts[key]=(songCounts[key]||0)+1; });
  const topSongEntries = Object.entries(songCounts).sort((a,b)=>b[1]-a[1]);
  if (topSongEntries.length > 0 && topSongEntries[0][1] >= 1) {
    const topSongKey = topSongEntries[0][0];
    const firstPost = songPosts.find(p => (p.songName||'').trim().toLowerCase() === topSongKey);
    if (firstPost) result.hottrack = {uid: firstPost.authorUid, name: firstPost.anonymous?'익명':resolveAuthorName(firstPost.authorUid, firstPost.authorName), song: firstPost.songName};
  }

  // 5. 이달의 수다왕 — 이번 달 게시글+댓글 합산 최다 (댓글은 postComments 서브컬렉션이라 실시간 집계가 어려워 게시글 수로 근사)
  const postCounts = {};
  monthPosts.forEach(p => { if (p.authorUid) postCounts[p.authorUid] = (postCounts[p.authorUid]||0) + 1 + (p.commentCount||0); });
  const chattyEntries = Object.entries(postCounts).sort((a,b)=>b[1]-a[1]);
  if (chattyEntries.length > 0 && chattyEntries[0][1] >= 1) {
    const samplePost = monthPosts.find(p => p.authorUid === chattyEntries[0][0]);
    result.chatty = {uid: chattyEntries[0][0], name: samplePost?.anonymous?'익명':resolveAuthorName(chattyEntries[0][0], samplePost?.authorName), count: chattyEntries[0][1]};
  }

  // 6. 이달의 새싹 — 이번 달 가입한 회원 중 첫 벙 참석까지 걸린 기간이 가장 짧은 회원
  const newMembers = members.filter(m => m.joinDate && ymKey(new Date(m.joinDate)) === ym);
  if (newMembers.length > 0) {
    const candidates = newMembers.map(m => {
      const firstAttended = bungs.filter(b => (b.attendees||[]).includes(m.id))
        .sort((a,b)=>new Date(a.date)-new Date(b.date))[0];
      if (!firstAttended) return null;
      const days = Math.round((new Date(firstAttended.date) - new Date(m.joinDate)) / (1000*60*60*24));
      return {name: m.name, uid: m.linkedUid, days: Math.max(days,0)};
    }).filter(Boolean);
    if (candidates.length > 0) {
      candidates.sort((a,b)=>a.days-b.days);
      result.sprout = {uid: candidates[0].uid, name: candidates[0].name, days: candidates[0].days};
    }
  }

  return result;
}

// 지난 달이 끝났는데 아직 확정 기록이 없으면 자동으로 1회 확정 저장 (운영진 로그인 시점에 체크)
let seasonFinalizeChecking = false;
async function checkAndFinalizeSeasonAwards() {
  if (!isAdmin || seasonFinalizeChecking) return;
  seasonFinalizeChecking = true;
  try {
    const lastMonthDate = new Date(TODAY.getFullYear(), TODAY.getMonth()-1, 1);
    const lastYm = ymKey(lastMonthDate);
    const alreadyDone = seasonAwards.some(s => s.ym === lastYm);
    if (!alreadyDone) {
      const awards = calcSeasonAwardsForMonth(lastYm);
      if (Object.keys(awards).length > 0) {
        await setDoc(doc(db, 'seasonAwards', lastYm), {ym: lastYm, awards, finalizedAt: serverTimestamp()});
      }
    }
  } finally {
    seasonFinalizeChecking = false;
  }
}

// 현재 진행 중인 이번 달 시즌 업적 현황 (실시간, 미확정)
function getCurrentSeasonAwards() {
  return calcSeasonAwardsForMonth(ymKey(TODAY));
}

function renderSeasonAwardsCard() {
  const thisYm = ymKey(TODAY);
  const current = getCurrentSeasonAwards();
  const pastRecords = [...seasonAwards].sort((a,b)=>b.ym.localeCompare(a.ym));
  const currentHTML = SEASON_AWARD_DEFS.map(def => {
    const a = current[def.id];
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border)">
      <span style="font-size:20px">${def.icon}</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500">${def.label}</div>
        <div style="font-size:11px;color:var(--text2)">${def.desc}</div>
      </div>
      <div style="font-size:13px;font-weight:500;color:${a?'var(--warn)':'var(--text2)'}">${a?esc(a.name):'아직 없음'}</div>
    </div>`;
  }).join('');
  const historyHTML = pastRecords.length === 0 ? '' : `
    <div style="font-size:12px;font-weight:500;color:var(--text2);margin:14px 0 8px">📜 지난 기록</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${pastRecords.map(rec => {
        const items = SEASON_AWARD_DEFS.filter(def => rec.awards[def.id]).map(def => {
          const a = rec.awards[def.id];
          return `<span title="${def.label} · ${esc(a.name)}" style="font-size:13px;background:var(--bg2);border:0.5px solid var(--border);border-radius:20px;padding:3px 9px">${def.icon} ${esc(a.name)}</span>`;
        }).join('');
        return `<div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">${esc(rec.ym)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${items}</div>
        </div>`;
      }).join('')}
    </div>`;
  return `<div class="hall-card"><h3>🏆 이달의 칭호 (시즌 업적)</h3>
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px">${thisYm} 진행 중 — 월말에 확정되어 영구 기록됩니다</div>
    ${currentHTML}
    ${historyHTML}
  </div>`;
}

// ── 렌더링 ────────────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderTodaySong();
  renderDashboardAlerts();
  renderDashboardAchievements();
  renderMembers();
  renderLinkRequests();
  renderBungs();
  renderGhost();
  renderStats();
  renderReport();
  renderHall();
  renderUpdates();
  renderNotices();
  renderBoardList();
  // 따로 그려지는 탭은 지금 보고 있을 때만 갱신 (다른 운영진이 수정한 내용이 바로 반영되도록)
  if (currentTab === 'calendar') renderCalendar();
  if (currentTab === 'profile' && !selectedMemberId) renderProfileList();
}

function renderDashboard() {
  const sc = getStatusCycle();
  const cd = sc.date;
  const c = {total:members.length, ghost:0, warn:0, safe:0, new:0};
  members.forEach(m => {
    const s = getMemberStatus(m, cd);
    if (s==='ghost') c.ghost++;
    else if (s==='contacted') c.warn++;
    else if (s==='safe') c.safe++;
    else c.new++;
  });

  const heroEl = document.getElementById('dash-hero');
  if (heroEl) {
    // 오늘 있는 벙도 "다음 예정 벙"에 포함 (예전에는 오전 9시가 지나면 오늘 벙이 사라졌음)
    const today = todayStr();
    const upcoming = bungs.filter(b=>b.date && b.date>=today).sort((a,b)=>a.date.localeCompare(b.date));
    const nextBung = upcoming[0]||null;
    if (nextBung) {
      const daysLeft = daysUntil(nextBung.date);
      const d = parseDateStr(nextBung.date);
      const weekdays = ['일','월','화','수','목','금','토'];
      const host = nextBung.hostId ? members.find(x=>x.id===nextBung.hostId) : null;
      heroEl.innerHTML = `<div class="hero-card">
        <svg class="hero-wave" viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" width="300" height="200">
          <path d="M0,100 C30,60 60,140 90,100 C120,60 150,140 180,100 C210,60 240,140 270,100" stroke="var(--info)" stroke-width="3" fill="none"/>
          <path d="M0,130 C30,90 60,170 90,130 C120,90 150,170 180,130 C210,90 240,170 270,130" stroke="var(--purple)" stroke-width="2" fill="none"/>
          <circle cx="240" cy="50" r="30" stroke="var(--purple)" stroke-width="1.5" fill="none"/>
          <circle cx="240" cy="50" r="18" stroke="var(--purple)" stroke-width="1" fill="none"/>
          <line x1="240" y1="80" x2="240" y2="95" stroke="var(--purple)" stroke-width="1.5"/>
          <line x1="225" y1="90" x2="255" y2="90" stroke="var(--purple)" stroke-width="1.5"/>
        </svg>
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;position:relative">
          <div>
            <div style="font-size:11px;color:var(--text2);font-weight:500;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px">${daysLeft===0?'오늘의 벙':'다음 예정 벙'}</div>
            <div style="font-size:22px;font-weight:500;margin-bottom:10px">${esc(nextBung.name)}</div>
            <div style="display:flex;gap:14px;flex-wrap:wrap">
              <span style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px"><i class="ti ti-calendar" style="font-size:14px;color:var(--info)"></i>${d.getMonth()+1}월 ${d.getDate()}일(${weekdays[d.getDay()]})</span>
              ${nextBung.place?`<span style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px"><i class="ti ti-map-pin" style="font-size:14px;color:var(--danger)"></i>${esc(nextBung.place)}</span>`:''}
              ${nextBung.time?`<span style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px"><i class="ti ti-clock" style="font-size:14px;color:var(--success)"></i>${esc(nextBung.time)}</span>`:''}
              ${host?`<span style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px"><i class="ti ti-crown" style="font-size:14px;color:var(--warn)"></i>${esc(host.name)}</span>`:''}
              ${(nextBung.attendees||[]).length?`<span style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px"><i class="ti ti-users" style="font-size:14px;color:var(--purple)"></i>${(nextBung.attendees||[]).length}명</span>`:''}
            </div>
          </div>
          <div style="text-align:center;flex-shrink:0">
            ${daysLeft===0
              ? `<div class="hero-dday is-today">오늘</div><div style="font-size:13px;color:var(--danger);font-weight:500;margin-top:2px">D-DAY 🎤</div>`
              : `<div class="hero-dday">${daysLeft}</div><div style="font-size:13px;color:var(--info);font-weight:500;margin-top:2px">일 후</div>`}
          </div>
        </div>
      </div>`;
    } else {
      heroEl.innerHTML = `<div class="hero-card"><svg class="hero-wave" viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" width="300" height="200"><path d="M0,100 C30,60 60,140 90,100 C120,60 150,140 180,100 C210,60 240,140 270,100" stroke="var(--info)" stroke-width="3" fill="none"/></svg>
        <div style="position:relative"><div style="font-size:11px;color:var(--text2);font-weight:500;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px">KIKU 회원 관리</div>
        <div style="font-size:22px;font-weight:500">예정된 벙이 없어요</div>
        <div style="font-size:13px;color:var(--text2);margin-top:6px">벙 관리 탭에서 새 벙을 추가해보세요</div></div></div>`;
    }
  }

  const statsEl = document.getElementById('dash-stats-card');
  if (statsEl) statsEl.innerHTML = `<div class="stat-card-big">
    <div class="stat-card-icon">👥</div>
    <div style="font-size:11px;color:var(--text2);font-weight:500;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:12px">회원 현황</div>
    <div style="display:flex;gap:20px;margin-bottom:14px">
      <div><div style="font-size:36px;font-weight:500;line-height:1">${c.total}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">전체 회원</div></div>
      <div style="width:0.5px;background:var(--border)"></div>
      <div><div style="font-size:36px;font-weight:500;line-height:1">${bungs.length}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">총 벙</div></div>
    </div>
    <div style="display:flex;gap:8px">
      <span style="font-size:11px;padding:3px 8px;border-radius:20px;background:var(--success-bg);color:var(--success)">정상 ${c.safe}명</span>
      <span style="font-size:11px;padding:3px 8px;border-radius:20px;background:var(--info-bg);color:var(--info)">신규 ${c.new}명</span>
    </div>
    <button class="btn btn-sm" onclick="switchTab('members')" style="margin-top:12px;font-size:12px;width:100%">회원 명단 →</button>
  </div>`;

  const ghostEl = document.getElementById('dash-ghost-card');
  // 정리 완료 전에는 이번 기산일 대상(빨강), 완료 후에는 다음 기산일 기준 미리보기(주황)
  const hasGhost = !sc.preview && c.ghost>0;
  if (ghostEl) ghostEl.innerHTML = `<div class="stat-card-big" style="${hasGhost?'border-color:var(--danger-border)':''}">
    <div class="stat-card-icon">👻</div>
    <div style="font-size:11px;color:var(--text2);font-weight:500;letter-spacing:0.5px;margin-bottom:12px">유령 현황 · ${sc.preview?`다음 정리(${shortDate(cd)}) 미리보기`:`이번 정리(${shortDate(cd)}) 기준`}</div>
    <div style="display:flex;gap:20px;margin-bottom:10px">
      <div><div style="font-size:36px;font-weight:500;line-height:1;color:${c.ghost>0?(sc.preview?'var(--warn)':'var(--danger)'):'var(--text)'}">${c.ghost}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">${sc.preview?'정리 위험':'퇴출 대상'}</div></div>
      <div style="width:0.5px;background:var(--border)"></div>
      <div><div style="font-size:36px;font-weight:500;line-height:1;color:${c.warn>0?'var(--purple)':'var(--text)'}">${c.warn}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">연락 완료</div></div>
    </div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px">${sc.preview?`이번 정리(${shortDate(getGhostCycleDate(0))}) 완료 ✓ · 다음 정리 전까지 참석이 없으면 대상이 돼요`:'정리를 마치고 유령 정리 탭에서 초기화하면 다음 정리 기준으로 바뀌어요'}</div>
    <button class="btn btn-sm ${hasGhost?'btn-danger':''}" onclick="switchTab('ghost')" style="font-size:12px;width:100%">유령 정리 탭 →</button>
  </div>`;

  const recentEl = document.getElementById('dash-recent-bung');
  if (recentEl) {
    const recent = [...bungs].filter(b=>b.date && b.date<=todayStr()).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
    recentEl.innerHTML = `<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1.25rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:13px;font-weight:500">최근 벙</div>
        <button class="btn btn-sm" onclick="switchTab('bung')" style="font-size:11px">전체 →</button>
      </div>
      ${recent.length===0?'<div style="font-size:13px;color:var(--text2)">기록된 벙이 없습니다.</div>':
      recent.map((b,i)=>{
        const names=(b.attendees||[]).map(id=>{const m=members.find(x=>x.id===id);return m?esc([...(m.name||'?')][0]):'?'});
        const typeBadge=b.type==='번개'?'<span class="badge badge-bungae">번개</span>':'<span class="badge badge-jeongmo">정모</span>';
        return `<div class="timeline-item" style="${i===recent.length-1?'border-bottom:none':''}">
          <div style="display:flex;flex-direction:column;align-items:center;padding-top:4px">
            <div class="timeline-dot"></div>
            ${i<recent.length-1?'<div class="timeline-line" style="flex:1;margin-top:4px"></div>':''}
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">${typeBadge}<strong style="font-size:13px">${esc(b.name)}</strong></div>
            <div style="font-size:12px;color:var(--text2);margin-bottom:6px">${formatDate(b.date)}${b.place?` · ${esc(b.place)}`:''}</div>
            <div style="display:flex;gap:2px;flex-wrap:wrap">${names.slice(0,8).map(n=>`<div class="avatar">${n}</div>`).join('')}${names.length>8?`<div class="avatar" style="background:var(--bg2);color:var(--text2)">+${names.length-8}</div>`:''}</div>
          </div>
          <div style="font-size:12px;color:var(--text2);flex-shrink:0">${(b.attendees||[]).length}명</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  const mvpEl = document.getElementById('dash-mvp');
  if (mvpEl) {
    const thisMonth = `${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}`;
    const thisMonthBungs = bungs.filter(b=>b.date.startsWith(thisMonth));
    let mvp = null;
    if (thisMonthBungs.length > 0) {
      const ac = {};
      thisMonthBungs.forEach(b=>(b.attendees||[]).forEach(id=>{ac[id]=(ac[id]||0)+1;}));
      const topId = Object.keys(ac).sort((a,b)=>ac[b]-ac[a])[0];
      const mvpMember = topId ? members.find(x=>x.id===topId) : null;
      if (mvpMember) mvp = {...mvpMember, count:ac[topId], total:thisMonthBungs.length};
    }
    mvpEl.innerHTML = `<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem">
      <div style="font-size:12px;font-weight:500;color:var(--text2);letter-spacing:0.4px;text-transform:uppercase;margin-bottom:10px">⭐ 이달의 MVP</div>
      ${mvp?`<div style="display:flex;align-items:center;gap:10px">
        ${mvp.photoURL?`<img src="${esc(mvp.photoURL)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0">`:`<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--warn-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:500;flex-shrink:0">${esc([...mvp.name][0]||'')}</div>`}
        <div><div style="font-weight:500">${esc(mvp.name)}</div><div style="font-size:12px;color:var(--text2);margin-top:2px">이번 달 ${mvp.count}/${mvp.total}회 참석</div></div>
        <div style="margin-left:auto;font-size:22px">🏆</div>
      </div>`:`<div style="font-size:13px;color:var(--text2)">이번 달 벙 기록 없음</div>`}
    </div>`;
  }

  const newbiesEl = document.getElementById('dash-newbies');
  if (newbiesEl) {
    const thisMonth = `${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}`;
    const newbies = members.filter(m=>m.joinDate&&m.joinDate.startsWith(thisMonth));
    newbiesEl.innerHTML = `<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem">
      <div style="font-size:12px;font-weight:500;color:var(--text2);letter-spacing:0.4px;text-transform:uppercase;margin-bottom:10px">🌱 이번 달 신규 (${newbies.length}명)</div>
      ${newbies.length===0?'<div style="font-size:13px;color:var(--text2)">신규 회원 없음</div>':
      `<div style="display:flex;flex-wrap:wrap;gap:6px">${newbies.map(m=>`<span style="font-size:12px;padding:3px 10px;border-radius:20px;background:var(--success-bg);color:var(--success);font-weight:500">${esc(m.name)}</span>`).join('')}</div>`}
    </div>`;
  }

  const annexEl = document.getElementById('dash-anniversary');
  if (annexEl) {
    const today0 = parseDateStr(todayStr());
    const upcoming14 = members.map(m=>{
      if (!m.joinDate) return null;
      const join = parseDateStr(m.joinDate);
      // 올해 기념일이 이미 지났으면 내년 기념일 기준 (12월 말에 1월 초 기념일도 보이도록)
      let anniv = new Date(today0.getFullYear(), join.getMonth(), join.getDate());
      if (anniv < today0) anniv = new Date(today0.getFullYear()+1, join.getMonth(), join.getDate());
      const years = anniv.getFullYear()-join.getFullYear();
      if (years < 1) return null;
      const diff = Math.round((anniv-today0)/(1000*60*60*24));
      if (diff > 14) return null;
      return {...m, years, diff};
    }).filter(Boolean).sort((a,b)=>a.diff-b.diff);
    annexEl.innerHTML = `<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem">
      <div style="font-size:12px;font-weight:500;color:var(--text2);letter-spacing:0.4px;text-transform:uppercase;margin-bottom:10px">🎂 다가오는 기념일</div>
      ${upcoming14.length===0?'<div style="font-size:13px;color:var(--text2)">2주 내 기념일 없음</div>':
      `<div style="display:flex;flex-direction:column;gap:6px">${upcoming14.map(m=>`<div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;font-weight:500">${esc(m.name)} <span style="font-size:11px;color:var(--warn)">${m.years}주년</span></div>
        <div style="font-size:12px;color:var(--text2)">${m.diff===0?'오늘!':m.diff+'일 후'}</div>
      </div>`).join('')}</div>`}
    </div>`;
  }
}

// ── 오늘의 노래 추천 ─────────────────────────────────────────────
function dateSeed(d) {
  const s = `${d.getFullYear()}${d.getMonth()}${d.getDate()}`;
  let h = 0;
  for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function getSongPool() {
  const fromPlaylist = playlist.map(p => ({songName:p.songName, artistName:p.artistName||'', youtubeUrl:p.youtubeUrl||'', source:'playlist', addedBy:resolveAuthorName(p.addedByUid, p.addedBy)||'운영진'}));
  const fromBoard = posts.filter(p=>p.type==='song' && p.songName).map(p => ({songName:p.songName, artistName:p.artistName||'', youtubeUrl:p.youtubeUrl||'', source:'board', addedBy:p.anonymous?'익명':resolveAuthorName(p.authorUid, p.authorName)}));
  return [...fromPlaylist, ...fromBoard];
}

function renderTodaySong() {
  const el = document.getElementById('dash-song');
  if (!el) return;
  const pool = getSongPool();
  if (pool.length === 0) {
    el.innerHTML = `<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem">
      <div style="font-size:12px;font-weight:500;color:var(--text2);letter-spacing:0.4px;text-transform:uppercase;margin-bottom:8px">🎵 오늘의 노래 추천</div>
      <div style="font-size:13px;color:var(--text2)">등록된 추천곡이 없습니다. ${isAdmin?'플레이리스트를 추가하거나 ':''}게시판에서 노래를 추천해보세요!</div>
      ${isAdmin?`<button class="btn btn-sm" style="margin-top:8px" onclick="openPlaylistManager()"><i class="ti ti-playlist"></i> 플레이리스트 관리</button>`:''}
    </div>`;
    return;
  }
  const idx = dateSeed(TODAY) % pool.length;
  const pick = pool[idx];
  const sourceLabel = pick.source === 'playlist' ? `운영진 플레이리스트` : `${pick.addedBy} 추천`;
  el.innerHTML = `<div style="background:linear-gradient(135deg,var(--purple-bg),var(--info-bg));border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem">
    <div class="flex-between" style="margin-bottom:8px">
      <div style="font-size:12px;font-weight:500;color:var(--text2);letter-spacing:0.4px;text-transform:uppercase">🎵 오늘의 노래 추천</div>
      ${isAdmin?`<button class="btn btn-sm" onclick="openPlaylistManager()"><i class="ti ti-playlist"></i> 관리</button>`:''}
    </div>
    <div style="font-size:18px;font-weight:600">${esc(pick.songName)}</div>
    ${pick.artistName?`<div style="font-size:13px;color:var(--text2);margin-top:2px">${esc(pick.artistName)}</div>`:''}
    <div style="font-size:11px;color:var(--text3);margin-top:8px">${esc(sourceLabel)} · 추천곡 ${pool.length}개 중 오늘의 선곡${getYoutubeId(pick.youtubeUrl)?` · <a href="https://youtu.be/${getYoutubeId(pick.youtubeUrl)}" target="_blank" rel="noopener" style="color:var(--info)"><i class="ti ti-brand-youtube" style="vertical-align:-2px"></i> 듣기</a>`:''}</div>
  </div>`;
}

window.openPlaylistManager = function() {
  if (!isAdmin) return;
  openModal(`<div class="modal-title"><i class="ti ti-playlist" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>플레이리스트 관리</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">여기에 추가한 곡과 노래 추천 게시판에 올라온 곡이 함께 "오늘의 노래 추천" 풀에 들어갑니다.</div>
    <div class="form-row">
      <div class="form-group"><label>곡명</label><input type="text" id="pl-song" placeholder="예: Lemon"></div>
      <div class="form-group"><label>아티스트</label><input type="text" id="pl-artist" placeholder="예: 요네즈 켄시"></div>
    </div>
    <div class="form-group"><label>유튜브 링크 (선택)</label>
      <div class="flex" style="gap:6px">
        <input type="text" id="pl-youtube" placeholder="https://youtu.be/..." style="flex:1">
        <button type="button" class="btn btn-sm" onclick="searchYoutubeFor('pl-song','pl-artist')"><i class="ti ti-search"></i> 유튜브에서 찾기</button>
      </div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px">⚠️ 유튜브 링크가 없으면 이 곡은 노래 이상형월드컵 후보에 들어갈 수 없어요.</div>
    </div>
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="addPlaylistSong()"><i class="ti ti-plus"></i> 추가</button>
    <div style="font-size:13px;font-weight:500;margin-bottom:8px">등록된 플레이리스트 (${playlist.length}곡)</div>
    <div id="playlist-manage-list" style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;margin-bottom:14px"></div>
    <div class="flex" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">닫기</button></div>`);
  renderPlaylistManager();
};

function renderPlaylistManager() {
  const el = document.getElementById('playlist-manage-list');
  if (!el) return;
  if (playlist.length === 0) { el.innerHTML = '<div style="font-size:13px;color:var(--text2)">등록된 곡이 없습니다.</div>'; return; }
  el.innerHTML = playlist.map(p => `<div class="flex-between" style="background:var(--bg2);border-radius:var(--radius);padding:8px 10px">
    <div><span style="font-size:13px;font-weight:500">${esc(p.songName)}</span>${p.artistName?`<span style="font-size:12px;color:var(--text2);margin-left:6px">${esc(p.artistName)}</span>`:''}${p.youtubeUrl?'<span style="font-size:11px;margin-left:6px" title="유튜브 링크 등록됨">🎬</span>':''}</div>
    <button class="btn btn-sm btn-danger" onclick="deletePlaylistSong('${p.id}')"><i class="ti ti-trash"></i></button>
  </div>`).join('');
}

window.addPlaylistSong = async function() {
  if (!isAdmin) return;
  const songName = document.getElementById('pl-song').value.trim();
  const artistName = document.getElementById('pl-artist').value.trim();
  const youtubeUrl = document.getElementById('pl-youtube').value.trim();
  if (!songName) { alert('곡명을 입력해주세요.'); return; }
  if (youtubeUrl && !getYoutubeId(youtubeUrl)) { alert('유튜브 링크 형식이 올바르지 않아요. 링크를 다시 확인해주세요.'); return; }
  await addDoc(collection(db, 'playlist'), {songName, artistName, youtubeUrl, addedBy: authorDisplayName(), addedByUid: currentUser.uid, createdAt: serverTimestamp()});
  document.getElementById('pl-song').value = '';
  document.getElementById('pl-artist').value = '';
  document.getElementById('pl-youtube').value = '';
  toast(`"${songName}" 추가했어요`);
};

window.deletePlaylistSong = async function(id) {
  if (!isAdmin) return;
  await deleteDoc(doc(db, 'playlist', id));
};

function renderDashboardAlerts() {
  const cd = getCalcDate();
  const el = document.getElementById('dashboard-alerts');
  if (!el) return;
  if (isCalcDay() && !isCurrentCycleDone()) {
    el.innerHTML = `<div class="alert alert-danger"><i class="ti ti-alert-triangle"></i><div><strong>오늘이 유령 회원 정리일입니다!</strong> 유령 정리 탭에서 조치 후 초기화를 진행해주세요.</div></div>`;
  } else if (isAdmin && !isCurrentCycleDone() && toDateStr(getGhostCycleDate(0)) < todayStr()) {
    // 기산일이 지났는데 아직 이번 정리를 마치지 않은 경우 (운영진에게만 표시)
    const cur = getGhostCycleDate(0);
    el.innerHTML = `<div class="alert alert-warning" style="align-items:center"><i class="ti ti-ghost"></i><div style="flex:1"><strong>이번 유령 정리(${formatDate(cur)} 기준)가 아직 남아 있어요.</strong> 정리 후 초기화하면 완료로 바뀌어요. <span style="opacity:.8">다음 정리일: ${formatDate(cd)}</span></div><button class="btn btn-sm btn-warn" onclick="switchTab('ghost')" style="flex-shrink:0">정리하기 →</button></div>`;
  } else {
    // 정리일 당일에 이미 정리를 마쳤으면 그 다음 정리일을 안내
    const next = isCalcDay() ? getGhostCycleDate(-1) : cd;
    const diff = daysUntil(toDateStr(next)); // 시각과 무관하게 달력 날짜 차이로 계산
    el.innerHTML = diff <= 7
      ? `<div class="alert alert-warning"><i class="ti ti-clock"></i>다음 유령 정리일까지 <strong>${diff}일</strong> 남았습니다. (${formatDate(next)})</div>`
      : `<div class="alert alert-info"><i class="ti ti-info-circle"></i>다음 유령 정리일: <strong>${formatDate(next)}</strong> (${diff}일 후)</div>`;
  }
}

function renderDashboardAchievements() {
  const el = document.getElementById('dash-achievements');
  if (!el) return;
  const group = getGroupAchievements();
  const memberAchievs = members.map(m=>({m, count:getAchievements(m).filter(a=>a.unlocked).length}))
    .sort((a,b)=>b.count-a.count).slice(0,3);
  el.innerHTML = `<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1.25rem">
    <div style="font-size:13px;font-weight:500;margin-bottom:14px">🏅 소모임 업적</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      ${group.map(a=>`<div class="achievement-badge ${a.unlocked?'unlocked':''}"><span>${a.icon}</span><span>${a.label}</span></div>`).join('')}
    </div>
    ${memberAchievs.length>0?`<div style="font-size:13px;font-weight:500;margin-bottom:10px">🌟 업적 TOP 회원</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${memberAchievs.map((x,i)=>{
        const medals=['🥇','🥈','🥉'];
        const achvs=getAchievements(x.m).filter(a=>a.unlocked);
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border)">
          <span style="font-size:18px">${medals[i]}</span>
          <div style="flex:1"><div style="font-size:13px;font-weight:500">${esc(x.m.name)}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${achvs.map(a=>`<span title="${a.label}" style="font-size:16px">${a.icon}</span>`).join('')}</div></div>
          <div style="font-size:12px;color:var(--text2)">${x.count}개</div>
        </div>`;
      }).join('')}
    </div>`:''}
    <button class="btn btn-sm" onclick="switchTab('hall')" style="width:100%;margin-top:12px;font-size:12px">명예의 전당 →</button>
  </div>`;

  const feedEl = document.getElementById('dash-recent-achievements');
  if (feedEl) {
    const recentAchvs = [];
    members.forEach(m=>{getAchievements(m).filter(a=>a.unlocked).forEach(a=>recentAchvs.push({member:m.name,icon:a.icon,label:a.label}));});
    if (recentAchvs.length > 0) {
      const show = recentAchvs.slice(-6).reverse();
      feedEl.innerHTML = `<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem">
        <div style="font-size:12px;font-weight:500;color:var(--text2);letter-spacing:0.4px;text-transform:uppercase;margin-bottom:10px">🎖️ 업적 현황</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${show.map(a=>`<div style="display:flex;align-items:center;gap:6px;background:var(--bg2);border-radius:var(--radius);padding:6px 10px;font-size:12px">
            <span style="font-size:16px">${a.icon}</span><span style="font-weight:500">${esc(a.member)}</span><span style="color:var(--text2)">${a.label}</span>
          </div>`).join('')}
        </div>
      </div>`;
    } else feedEl.innerHTML = '';
  }
}

function renderLinkRequests() {
  const el = document.getElementById('link-requests-area');
  if (!el) return;
  const pending = members.filter(m => m.linkPendingUid);
  if (pending.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="alert alert-info" style="flex-direction:column;align-items:stretch;gap:8px;margin-bottom:1rem">
    <div style="font-weight:500"><i class="ti ti-user-plus"></i> 프로필 연결 요청 (${pending.length}건)</div>
    ${pending.map(m=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--bg);border-radius:var(--radius);padding:8px 12px;flex-wrap:wrap">
      <span style="font-size:13px;min-width:0">"<strong>${esc(m.linkPendingName)}</strong>"님이 <strong>${esc(m.name)}</strong> 회원으로 연결을 요청했습니다.</span>
      <div class="flex" style="gap:6px;flex-shrink:0">
        <button class="btn btn-sm btn-primary" onclick="approveProfileLink('${m.id}')">승인</button>
        <button class="btn btn-sm btn-danger" onclick="rejectProfileLink('${m.id}')">거부</button>
      </div>
    </div>`).join('')}
  </div>`;
}

let memberSearchQuery = '';
function renderMembers() {
  const sc = getStatusCycle();
  const cd = sc.date;
  const tbody = document.getElementById('member-tbody');
  const empty = document.getElementById('member-empty');
  if (!tbody) return;
  const statusTh = document.getElementById('member-status-th');
  if (statusTh) {
    statusTh.innerHTML = `상태 <span style="font-weight:400;color:var(--text3)">· ${sc.preview?'다음':'이번'} 정리 ${shortDate(cd)}</span>`;
    statusTh.title = sc.preview ? `이번 정리를 마쳐서 다음 정리(${formatDate(cd)}) 기준으로 표시 중` : `이번 정리(${formatDate(cd)}) 기준으로 표시 중`;
  }
  if (members.length === 0) { tbody.innerHTML = ''; empty.style.display='block'; applyMemberFilter(); return; }
  empty.style.display = 'none';
  const sortVal = document.getElementById('member-sort')?.value || 'join';
  const attendCount = {};
  bungs.forEach(b => (b.attendees||[]).forEach(id => { attendCount[id] = (attendCount[id]||0) + 1; }));
  const sorted = [...members].sort((a,b)=>{
    if (sortVal==='name') return (a.name||'').localeCompare(b.name||'','ko');
    if (sortVal==='rate') return (attendCount[b.id]||0) - (attendCount[a.id]||0);
    return (a.joinDate||'').localeCompare(b.joinDate||'');
  });
  // 이번 정리 기준이면 "유령 대상"(빨간 줄), 정리를 마친 뒤 다음 정리 미리보기면 "정리 위험"(주황)
  const badgeMap = {ghost: sc.preview ? `<span class="badge badge-bungae" title="다음 정리(${shortDate(cd)}) 전까지 참석이 없으면 유령 대상">정리 위험</span>` : '<span class="badge badge-ghost">유령 대상</span>',contacted:'<span class="badge badge-contact">연락 완료</span>',safe:'<span class="badge badge-safe">정상</span>',new:'<span class="badge badge-new">신규</span>'};
  tbody.innerHTML = sorted.map(m=>{
    const status = getMemberStatus(m, cd);
    const rc = status==='ghost' && !sc.preview ?' class="member-row-ghost"':'';
    const attended = attendCount[m.id]||0;
    const rate = bungs.length>0?Math.round(attended/bungs.length*100):0;
    const grade = getMemberGrade(rate);
    const gradeBadge = `<span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:${grade.bg};color:${grade.color};font-weight:500">${grade.label}</span>`;
    const memo = m.memo?`<div class="memo-text">📝 ${esc(m.memo)}</div>`:'<span style="color:var(--text3);font-size:12px">-</span>';
    const linkBadge = m.linkedUid ? `<i class="ti ti-link" style="color:var(--success);font-size:12px;margin-left:4px" title="계정 연결됨"></i>` : '';
    const roleLabel = m.role==='admin' ? '운영진' : m.role==='host' ? '모임장' : '';
    const roleBadge = roleLabel ? `<span style="font-size:10px;background:var(--warn-bg);color:var(--warn);padding:1px 5px;border-radius:3px;margin-left:4px">${roleLabel}</span>` : '';
    const aliases = memberAliases(m);
    const aliasCell = aliases.map(a => `<span class="alias-chip">${esc(a)}</span>`).join('')
      + (isAdmin ? `<button class="alias-edit-btn" onclick="openEditAliases('${m.id}')" title="별명 편집">${aliases.length ? '<i class="ti ti-pencil" style="font-size:11px;vertical-align:-1px"></i>' : '+ 별명'}</button>`
                 : (aliases.length ? '' : '<span style="color:var(--text3);font-size:12px">-</span>'));
    return `<tr${rc} data-search="${esc(memberKeys(m).join('|'))}"><td style="white-space:nowrap"><strong class="member-link" onclick="goToProfile('${m.id}')" title="프로필 보기">${esc(m.name)}</strong>${linkBadge}${roleBadge}</td><td style="max-width:180px">${aliasCell}</td><td>${formatDate(m.joinDate)}</td><td>${m.lastAttend?formatDate(m.lastAttend):'<span style="color:var(--text2)">없음</span>'}</td><td style="text-align:center"><input type="checkbox" class="contact-check" ${m.contacted?'checked':''} onchange="toggleContact('${m.id}',this.checked)" ${isAdmin?'':' disabled'}></td><td>${badgeMap[status]}</td><td>${gradeBadge}</td><td>${memo}</td><td class="edit-only"><div class="flex" style="gap:4px"><button class="btn btn-sm" onclick="openEditMember('${m.id}')"><i class="ti ti-edit"></i></button><button class="btn btn-sm" onclick="openSetRole('${m.id}')" title="역할 지정"><i class="ti ti-crown"></i></button>${m.linkedUid?`<button class="btn btn-sm" onclick="unlinkProfile('${m.id}')" title="연결 해제"><i class="ti ti-unlink"></i></button>`:''}<button class="btn btn-sm btn-danger" onclick="deleteMember('${m.id}')"><i class="ti ti-trash"></i></button></div></td></tr>`;
  }).join('');
  applyMemberFilter();
}
// 회원 명단 정렬 드롭다운(onchange="renderMembers()")에서 부를 수 있도록 전역에 노출
// (모듈 스크립트라 그동안 정렬을 바꿔도 동작하지 않았음)
window.renderMembers = renderMembers;

// 검색어는 이름·별명 모두에서, 대소문자 무시하고 찾음. 데이터가 바뀌어 목록이 다시 그려져도 검색 상태 유지.
window.filterMembers = function(q) { memberSearchQuery = q; applyMemberFilter(); };
function applyMemberFilter() {
  const key = normName(memberSearchQuery);
  let shown = 0;
  document.querySelectorAll('#member-tbody tr').forEach(row => {
    const ok = !key || (row.dataset.search || '').includes(key);
    row.classList.toggle('is-hidden', !ok);
    if (ok) shown++;
  });
  const countEl = document.getElementById('member-count');
  if (countEl) countEl.textContent = members.length === 0 ? '' : key ? `${shown} / ${members.length}명` : `${members.length}명`;
}
window.goToProfile = function(id) { switchTab('profile'); openProfile(id); };

let bungSearchQuery = '';
window.filterBungs = function(q) { bungSearchQuery = q; renderBungs(); };
function bungMatchesQuery(b, key) {
  if (!key) return true;
  const people = (b.attendees||[]).flatMap(id => { const m = members.find(x => x.id === id); return m ? [m.name, ...memberAliases(m)] : []; });
  return [b.name, b.place, b.topic, b.type, ...people].map(normName).join('|').includes(key);
}

function renderBungs() {
  const el = document.getElementById('bung-list');
  if (!el) return;
  if (bungs.length === 0) { el.innerHTML='<div class="empty-state"><i class="ti ti-calendar-off"></i>등록된 벙이 없습니다.</div>'; return; }
  const today = todayStr();
  const key = normName(bungSearchQuery);
  const list = [...bungs].sort((a,b) => (b.date||'').localeCompare(a.date||'')).filter(b => bungMatchesQuery(b, key));
  if (list.length === 0) { el.innerHTML = `<div class="empty-state"><i class="ti ti-search"></i>"${esc(bungSearchQuery)}"에 해당하는 벙이 없어요.</div>`; return; }
  let lastYm = '';
  el.innerHTML = list.map(b=>{
    // 월이 바뀌는 곳마다 구분선 (예: 2026년 10월 · 3개)
    const ym = (b.date||'').slice(0,7);
    let divider = '';
    if (ym !== lastYm) {
      lastYm = ym;
      const [y, mo] = ym.split('-');
      divider = `<div class="month-divider">${y}년 ${parseInt(mo)}월 · ${list.filter(x => (x.date||'').startsWith(ym)).length}개</div>`;
    }
    const isToday = b.date === today;
    const isPast = b.date < today;
    const names = (b.attendees||[]).map(id=>{const m=members.find(x=>x.id===id);return m?m.name:'?'});
    const host = b.hostId ? members.find(x=>x.id===b.hostId) : null;
    const typeBadge = b.type==='번개'?'<span class="badge badge-bungae">번개</span>':'<span class="badge badge-jeongmo">정모</span>';
    const statusBadge = isToday ? '<span class="badge badge-today">오늘</span>' : isPast ? '<span class="badge badge-safe">완료</span>' : `<span class="badge badge-new">예정 · D-${daysUntil(b.date)}</span>`;
    const settledBadge = b.settlement ? '<span class="badge badge-safe"><i class="ti ti-receipt-2" style="font-size:11px"></i> 정산완료</span>' : '';
    return divider + `<div class="bung-card${isToday?' is-today':''}">
      <div class="flex-between mb-1">
        <div class="flex" style="min-width:0;flex-wrap:wrap">${typeBadge}<strong>${esc(b.name)}</strong>${statusBadge}${settledBadge}</div>
        <div class="flex" style="gap:4px;flex-wrap:wrap">
          <button class="btn btn-sm btn-info" onclick="openTemplate('${b.id}')"><i class="ti ti-speakerphone"></i> 공지</button>
          ${(isPast||isToday)?`<button class="btn btn-sm" onclick="openBungRecap('${b.id}')"><i class="ti ti-sparkles"></i> 회고</button>`:''}
          <button class="btn btn-sm" onclick="openSettlement('${b.id}')"><i class="ti ti-calculator"></i> 정산</button>
          <button class="btn btn-sm edit-only" onclick="openEditBung('${b.id}')"><i class="ti ti-edit"></i> 수정</button>
          <button class="btn btn-sm btn-danger edit-only" onclick="deleteBung('${b.id}')"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text2);display:flex;gap:12px;flex-wrap:wrap;margin-top:4px">
        <span><i class="ti ti-calendar" style="font-size:13px"></i> ${formatDate(b.date)}${b.time?` ${esc(b.time)}`:''}</span>
        ${b.place?`<span><i class="ti ti-map-pin" style="font-size:13px"></i> ${esc(b.place)}</span>`:''}
        ${host?`<span><i class="ti ti-crown" style="font-size:13px"></i> ${esc(host.name)}</span>`:''}
        <span><i class="ti ti-users" style="font-size:13px"></i> ${names.map(esc).join(', ')||'없음'} (${names.length}명)</span>
      </div>
      ${b.memo?`<div class="memo-text" style="margin-top:6px">📝 ${esc(b.memo)}</div>`:''}
    </div>`;
  }).join('');
}

function renderGhost() {
  const offset = resolvedGhostOffset();
  const selEl = document.getElementById('ghost-period-select');
  if (selEl) selEl.innerHTML = getGhostCycleOptions().map(o=>`<option value="${o.offset}" ${o.offset===offset?'selected':''}>${o.label}${o.offset===0&&isCurrentCycleDone()?' ✓ 완료':''}</option>`).join('');
  const cd = getGhostCycleDate(offset);
  const isExactlyToday = toDateStr(cd) === todayStr();
  const isCurrentCycle = offset===0;
  const cycleDone = isCurrentCycle && isCurrentCycleDone();
  const twoMonthsAgo = new Date(cd);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth()-2);
  const gcEl = document.getElementById('ghost-calc-info');
  if (gcEl) gcEl.textContent = `기산일: ${formatDate(cd)} | 대상: ${formatDate(twoMonthsAgo)} ~ ${formatDate(cd)}`;
  const resetBtn = document.getElementById('reset-btn');
  const doneBtn = document.getElementById('ghost-done-btn');
  const alertEl = document.getElementById('ghost-alert-area');
  if (alertEl) alertEl.innerHTML = offset===-1
    ? `<div class="alert alert-info"><i class="ti ti-clock"></i><div>다음 정리일(${formatDate(cd)})까지 <strong>${daysUntil(toDateStr(cd))}일</strong> 남았습니다. 지금 기록 기준으로 미리 본 목록이에요.${isCurrentCycleDone()?' <span style="opacity:.8">(이번 정리는 완료 ✓)</span>':''}</div></div>`
    : cycleDone
      ? `<div class="alert alert-success"><i class="ti ti-circle-check"></i><div><strong>이번 정리(기산일 ${formatDate(cd)})는 완료됐어요.</strong> 초기화 이후에는 연락 완료로 유예했던 회원도 다시 대상으로 보일 수 있으니 참고용으로만 보세요. 다음 정리 대상은 "다음 정리 예정"에서 확인할 수 있어요.</div></div>`
      : isCurrentCycle
        ? `<div class="alert alert-danger"><i class="ti ti-alert-triangle"></i><div><strong>${isExactlyToday?'오늘이 정리일입니다.':`이번 정리 주기입니다 (기산일 ${formatDate(cd)}).`}</strong> 목록 확인 후 조치를 마치면 초기화를 실행하세요. 초기화하면 이번 정리가 완료로 표시되고, 대시보드·회원 명단이 다음 정리 기준으로 바뀌어요.</div></div>`
        : `<div class="alert alert-info"><i class="ti ti-history"></i>지난 정리 주기(기산일 ${formatDate(cd)})를 조회 중입니다. 참고용입니다.</div>`;
  if (resetBtn) resetBtn.style.display = isCurrentCycle && !cycleDone ? '' : 'none';
  if (doneBtn) doneBtn.style.display = isCurrentCycle && !cycleDone ? '' : 'none';
  const ghostList = members.filter(m=>getMemberStatus(m,cd)==='ghost');
  const warnList = members.filter(m=>getMemberStatus(m,cd)==='contacted');
  const tableEl = document.getElementById('ghost-table-area');
  if (!tableEl) return;
  let html = '';
  if (ghostList.length===0 && warnList.length===0) {
    html = '<div style="font-size:13px;color:var(--text2);padding:1rem 0;text-align:center">유령 판정 대상자가 없습니다. ✓</div>';
  } else {
    if (ghostList.length>0) {
      html += `<div class="section-label">퇴출 대상 (${ghostList.length}명)</div>`;
      html += '<div style="border:0.5px solid var(--danger-border);border-radius:var(--radius-lg);overflow-x:auto;margin-bottom:1rem"><table style="min-width:520px"><thead><tr><th>이름</th><th>가입일</th><th>마지막 참여</th><th>조건1</th><th>조건2</th><th>조건3</th></tr></thead><tbody>';
      ghostList.forEach(m=>{
        const c1=new Date(m.joinDate)<=twoMonthsAgo?'<span style="color:var(--danger)">✗ 2달↑</span>':'<span style="color:var(--success)">✓ 신규</span>';
        const la=m.lastAttend?new Date(m.lastAttend):null;
        const c2=(!la||la<twoMonthsAgo)?'<span style="color:var(--danger)">✗ 미참여</span>':'<span style="color:var(--success)">✓ 참여</span>';
        const c3=m.contacted?'<span style="color:var(--success)">✓ 연락</span>':'<span style="color:var(--danger)">✗ 미연락</span>';
        html+=`<tr class="member-row-ghost"><td><strong>${esc(m.name)}</strong></td><td>${formatDate(m.joinDate)}</td><td>${m.lastAttend?formatDate(m.lastAttend):'없음'}</td><td>${c1}</td><td>${c2}</td><td>${c3}</td></tr>`;
      });
      html += '</tbody></table></div>';
    }
    if (warnList.length>0) {
      html += `<div class="section-label">연락 완료 — 유예 (${warnList.length}명)</div>`;
      html += '<div style="border:0.5px solid var(--warn-border);border-radius:var(--radius-lg);overflow-x:auto"><table style="min-width:320px"><thead><tr><th>이름</th><th>가입일</th><th>마지막 참여</th></tr></thead><tbody>';
      warnList.forEach(m=>{html+=`<tr><td><strong>${esc(m.name)}</strong></td><td>${formatDate(m.joinDate)}</td><td>${m.lastAttend?formatDate(m.lastAttend):'없음'}</td></tr>`;});
      html += '</tbody></table></div>';
    }
  }
  tableEl.innerHTML = html;
}
window.onGhostPeriodChange = function(v) {
  ghostSelectedOffset = parseInt(v, 10);
  renderGhost();
};

function renderStats() {
  const el = document.getElementById('stats-content');
  if (!el) return;
  const twoMonthsAgo = parseDateStr(recentWindowStartStr());
  const recentBungCount = getRecentBungs().length;
  const stats = getRecentMemberStats();
  if (members.length===0) { el.innerHTML='<div class="empty-state"><i class="ti ti-chart-bar"></i>벙과 회원 데이터가 있어야 통계를 볼 수 있어요.</div>'; return; }
  if (recentBungCount===0) { el.innerHTML='<div class="empty-state"><i class="ti ti-chart-bar"></i>최근 2개월간 진행된 벙이 없어요.<br><span style="font-size:12px">전체 역대 기록은 명예의 전당에서 확인하세요.</span></div>'; return; }
  const top3 = stats.filter(s=>s.attended>0).slice(0,3);
  const medals = ['🥇','🥈','🥉'];
  const gradeCount = {우수:stats.filter(s=>s.rate>=60).length, 활동:stats.filter(s=>s.rate>=20&&s.rate<60).length, 일반:stats.filter(s=>s.rate<20).length};
  el.innerHTML = `
  <div class="alert alert-info" style="margin-bottom:1.25rem"><i class="ti ti-info-circle"></i>최근 2개월(${formatDate(twoMonthsAgo)} ~ ${formatDate(TODAY)}) 활동성 통계입니다. 유령 판정 대상은 <strong>유령 정리</strong> 탭, 전체 역대 기록은 <strong>명예의 전당</strong>을 확인하세요.</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:1.5rem">
    <div class="metric"><div class="metric-label">최근 2개월 벙</div><div class="metric-value">${recentBungCount}회</div></div>
    <div class="metric"><div class="metric-label">⭐ 우수</div><div class="metric-value" style="color:var(--success)">${gradeCount.우수}명</div></div>
    <div class="metric"><div class="metric-label">✅ 활동</div><div class="metric-value" style="color:var(--info)">${gradeCount.활동}명</div></div>
    <div class="metric"><div class="metric-label">👤 일반</div><div class="metric-value" style="color:var(--text2)">${gradeCount.일반}명</div></div>
  </div>
  <div style="margin-bottom:1.5rem"><h3>🔥 최근 2개월 참여율 TOP 3</h3>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${top3.length===0?'<div style="font-size:13px;color:var(--text2)">최근 2개월 참여 기록이 없습니다.</div>':top3.map((s,i)=>`<div style="display:flex;align-items:center;gap:12px;background:var(--bg2);border-radius:var(--radius-lg);padding:10px 16px">
        <span style="font-size:20px">${medals[i]}</span>
        <div style="flex:1"><div style="font-weight:500">${esc(s.name)} <span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:${s.grade.bg};color:${s.grade.color};font-weight:500">${s.grade.label}</span></div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${s.attended}회 / 최근 ${recentBungCount}회</div></div>
        <div style="font-size:20px;font-weight:500;color:${s.grade.color}">${s.rate}%</div>
      </div>`).join('')}
    </div>
  </div>
  <div><h3>전체 회원 최근 2개월 참여율</h3>
    <div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow-x:auto">
      <table style="min-width:480px"><thead><tr><th>순위</th><th>이름</th><th>등급</th><th>참석</th><th>참여율</th><th>그래프</th></tr></thead><tbody>
      ${stats.map((s,i)=>`<tr><td style="color:var(--text2)">${i+1}</td><td><strong>${esc(s.name)}</strong></td>
        <td><span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:${s.grade.bg};color:${s.grade.color};font-weight:500">${s.grade.label}</span></td>
        <td>${s.attended}회</td><td style="font-weight:500;color:${s.grade.color}">${s.rate}%</td>
        <td style="min-width:80px"><div style="background:var(--bg3);border-radius:4px;height:8px;overflow:hidden"><div class="bar-fill" style="width:${s.rate}%;background:${s.grade.color};height:100%;border-radius:4px;animation-delay:${Math.min(i,12)*30}ms"></div></div></td>
      </tr>`).join('')}
      </tbody></table>
    </div>
    <div style="font-size:12px;color:var(--text2);margin-top:8px">등급 기준: ⭐ 우수 60% 이상 | ✅ 활동 20~59% | 👤 일반 20% 미만 (최근 2개월 기준)</div>
  </div>`;
}

function renderReport() {
  const el = document.getElementById('report-content');
  if (!el) return;
  if (bungs.length===0) { el.innerHTML='<div class="empty-state"><i class="ti ti-report"></i>벙 데이터가 있어야 리포트를 볼 수 있어요.</div>'; return; }
  const monthMap = {};
  const allBungs = [...bungs].sort((a,b)=>new Date(a.date)-new Date(b.date));
  allBungs.forEach(b=>{
    const d = new Date(b.date);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!monthMap[key]) monthMap[key]={count:0,attendTotal:0,jeongmo:0,bungae:0};
    monthMap[key].count++;
    monthMap[key].attendTotal += (b.attendees||[]).length;
    if (b.type==='번개') monthMap[key].bungae++; else monthMap[key].jeongmo++;
  });
  const months = Object.keys(monthMap).sort();
  const maxCount = Math.max(...months.map(k=>monthMap[k].count), 1);
  const quarterMap = {};
  allBungs.forEach(b=>{
    const d = new Date(b.date);
    const q = Math.ceil((d.getMonth()+1)/3);
    const key = `${d.getFullYear()} Q${q}`;
    if (!quarterMap[key]) quarterMap[key]={count:0,attendTotal:0};
    quarterMap[key].count++;
    quarterMap[key].attendTotal += (b.attendees||[]).length;
  });
  const quarters = Object.keys(quarterMap).sort();
  el.innerHTML = `
  <div style="margin-bottom:1.5rem"><h3>📊 월별 벙 현황</h3>
    <div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow-x:auto;margin-bottom:12px">
      <table style="min-width:520px"><thead><tr><th>월</th><th>횟수</th><th>정모</th><th>번개</th><th>평균 참석</th><th>그래프</th></tr></thead><tbody>
      ${months.map(k=>{
        const m=monthMap[k];const avg=m.count>0?Math.round(m.attendTotal/m.count):0;const [y,mo]=k.split('-');
        return `<tr><td><strong>${y}년 ${parseInt(mo)}월</strong></td><td>${m.count}회</td>
          <td><span class="badge badge-jeongmo">${m.jeongmo}</span></td><td><span class="badge badge-bungae">${m.bungae}</span></td><td>${avg}명</td>
          <td style="min-width:100px"><div style="background:var(--bg3);border-radius:4px;height:8px;overflow:hidden"><div class="bar-fill" style="width:${Math.round(m.count/maxCount*100)}%;background:var(--info);height:100%;border-radius:4px"></div></div></td>
        </tr>`;
      }).join('')}
      </tbody></table>
    </div>
  </div>
  <div><h3>📋 분기별 리포트</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
      ${quarters.map(k=>{const q=quarterMap[k];const avg=q.count>0?Math.round(q.attendTotal/q.count):0;
        return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem">
          <div style="font-weight:500;margin-bottom:8px">${k}</div>
          <div style="font-size:13px;color:var(--text2);line-height:2">벙 횟수: <strong style="color:var(--text)">${q.count}회</strong><br>평균 참석: <strong style="color:var(--text)">${avg}명</strong></div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderHall() {
  const el = document.getElementById('hall-content');
  if (!el) return;
  const stats = getMemberStats();
  const top3 = stats.slice(0,3);
  const medals = ['🥇','🥈','🥉'];
  const thisMonth = `${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}`;
  const thisMonthBungs = bungs.filter(b=>(b.date||'').startsWith(thisMonth)&&b.hostId);
  const hostCount = {};
  thisMonthBungs.forEach(b=>{hostCount[b.hostId]=(hostCount[b.hostId]||0)+1;});
  const topHostId = Object.keys(hostCount).sort((a,b)=>hostCount[b]-hostCount[a])[0];
  const topHost = topHostId ? members.find(x=>x.id===topHostId) : null;
  // 앞뒤 7일 이내 가입 기념일 (연말·연초에 걸쳐도 잡히도록 작년/올해/내년 기념일 중 가장 가까운 날 기준)
  const today0 = parseDateStr(todayStr());
  const anniversaries = members.map(m=>{
    if (!m.joinDate) return null;
    const join = parseDateStr(m.joinDate);
    const near = [-1,0,1].map(dy => new Date(today0.getFullYear()+dy, join.getMonth(), join.getDate()))
      .sort((a,b) => Math.abs(a-today0) - Math.abs(b-today0))[0];
    const years = near.getFullYear() - join.getFullYear();
    if (years < 1 || Math.abs(Math.round((near-today0)/86400000)) > 7) return null;
    return {...m, years};
  }).filter(Boolean);
  const sortedB=[...bungs].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const streakRanking = members.map(m=>{
    let max=0,cur=0;
    sortedB.forEach(b=>{if((b.attendees||[]).includes(m.id)){cur++;if(cur>max)max=cur;}else cur=0;});
    return{...m,maxStreak:max};
  }).filter(m=>m.maxStreak>0).sort((a,b)=>b.maxStreak-a.maxStreak).slice(0,5);
  const hostRanking = members.map(m=>{
    const hosted=bungs.filter(b=>b.hostId===m.id);
    return{...m,hosted:hosted.length,jeongmoHosted:hosted.filter(b=>b.type==='정모').length};
  }).filter(m=>m.hosted>0).sort((a,b)=>b.hosted-a.hosted).slice(0,5);
  const monthMVPs=[];
  for(let i=0;i<6;i++){
    const d=new Date(TODAY.getFullYear(),TODAY.getMonth()-i,1);
    const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const mb=bungs.filter(b=>(b.date||'').startsWith(ym));if(mb.length===0)continue;
    const ac={};mb.forEach(b=>(b.attendees||[]).forEach(id=>{ac[id]=(ac[id]||0)+1;}));
    const topId=Object.keys(ac).sort((a,b)=>ac[b]-ac[a])[0];
    const mvp=topId?members.find(x=>x.id===topId):null;
    if(mvp)monthMVPs.push({ym:`${d.getFullYear()}년 ${d.getMonth()+1}월`,name:mvp.name,count:ac[topId],total:mb.length});
  }
  el.innerHTML = `
  <div class="hall-card"><h3>👑 이달의 벙주 (${TODAY.getMonth()+1}월)</h3>
    ${topHost?`<div style="display:flex;align-items:center;gap:16px;padding:8px 0">
      ${topHost.photoURL?`<img src="${esc(topHost.photoURL)}" style="width:52px;height:52px;border-radius:50%;object-fit:cover">`:`<div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--warn-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:500">${esc([...topHost.name][0]||'')}</div>`}
      <div><div style="font-size:18px;font-weight:500">${esc(topHost.name)}</div><div style="font-size:13px;color:var(--text2);margin-top:3px">이번 달 ${hostCount[topHostId]}회 벙주</div></div>
      <div style="margin-left:auto;font-size:36px">👑</div></div>`:'<div style="font-size:13px;color:var(--text2);padding:8px 0">이번 달 벙주 기록 없음</div>'}
  </div>
  ${anniversaries.length>0?`<div class="hall-card"><h3>🎂 이번 주 가입 기념일</h3>
    ${anniversaries.map(m=>`<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:0.5px solid var(--border)">
      <span style="font-size:24px">🎉</span><div><strong>${esc(m.name)}</strong><span class="anniversary-badge">${m.years}주년</span>
      <div style="font-size:12px;color:var(--text2)">가입일: ${formatDate(m.joinDate)}</div></div></div>`).join('')}
  </div>`:''}
  <div class="hall-card"><h3>🏆 역대 참여율 명예의 전당</h3>
    ${bungs.length===0?'<div style="font-size:13px;color:var(--text2)">벙 데이터가 없습니다.</div>':
    `<div style="display:flex;flex-direction:column;gap:10px">${top3.map((s,i)=>`
      <div style="display:flex;align-items:center;gap:14px;background:var(--bg3);border-radius:var(--radius-lg);padding:12px 14px">
        <div style="font-size:28px">${medals[i]}</div>
        <div style="flex:1"><div style="font-weight:500">${esc(s.name)} <span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:${s.grade.bg};color:${s.grade.color};font-weight:500">${s.grade.label}</span></div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${s.attended}회 / 전체 ${bungs.length}회</div>
        <div style="background:var(--bg);border-radius:4px;height:5px;overflow:hidden;margin-top:6px"><div class="bar-fill" style="width:${s.rate}%;background:${s.grade.color};height:100%;border-radius:4px;animation-delay:${i*80}ms"></div></div></div>
        <div style="font-size:22px;font-weight:500;color:${s.grade.color}">${s.rate}%</div>
      </div>`).join('')}</div>`}
  </div>
  ${streakRanking.length>0?`<div class="hall-card"><h3>🔥 연속 참석 스트릭 랭킹</h3>
    <div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow-x:auto">
      <table style="min-width:380px"><thead><tr><th>순위</th><th>이름</th><th>최장 연속</th><th>그래프</th></tr></thead><tbody>
      ${streakRanking.map((m,i)=>`<tr><td style="color:var(--text2)">${i+1}</td><td><strong>${esc(m.name)}</strong></td>
        <td style="color:var(--warn);font-weight:500">${m.maxStreak}회</td>
        <td style="min-width:80px"><div style="background:var(--bg3);border-radius:4px;height:7px;overflow:hidden"><div class="bar-fill" style="width:${Math.round(m.maxStreak/streakRanking[0].maxStreak*100)}%;background:var(--warn);height:100%;border-radius:4px;animation-delay:${i*60}ms"></div></div></td>
      </tr>`).join('')}
      </tbody></table></div></div>`:''}
  ${hostRanking.length>0?`<div class="hall-card"><h3>🎙️ 벙주 랭킹</h3>
    <div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow-x:auto">
      <table style="min-width:340px"><thead><tr><th>순위</th><th>이름</th><th>전체</th><th>정모</th></tr></thead><tbody>
      ${hostRanking.map((m,i)=>`<tr><td>${i===0?'👑':i===1?'🥈':i===2?'🥉':i+1}</td><td><strong>${esc(m.name)}</strong></td>
        <td style="font-weight:500">${m.hosted}회</td><td style="color:var(--info)">${m.jeongmoHosted}회</td></tr>`).join('')}
      </tbody></table></div></div>`:''}
  ${monthMVPs.length>0?`<div class="hall-card"><h3>📅 월별 MVP 히스토리</h3>
    <div style="display:flex;flex-direction:column;gap:8px">${monthMVPs.map(m=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--border)">
        <div style="font-size:12px;color:var(--text2);min-width:80px">${m.ym}</div>
        <div style="flex:1;padding:0 12px"><strong>${esc(m.name)}</strong></div>
        <div style="font-size:12px;color:var(--text2)">${m.count}/${m.total}회</div>
      </div>`).join('')}</div></div>`:''}
  ${renderSeasonAwardsCard()}
  <div class="hall-card"><h3>🏅 개인 업적 현황</h3>
    ${members.length===0?'<div style="font-size:13px;color:var(--text2)">회원 데이터가 없습니다.</div>':
    '<div style="display:flex;flex-direction:column;gap:4px">'+
    members.map(m=>{const achvs=getAchievements(m);const unlocked=achvs.filter(a=>a.unlocked);if(unlocked.length===0)return '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border)">
        <div style="font-size:13px;font-weight:500;min-width:60px">${esc(m.name)}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;flex:1">${achvs.map(a=>{const lh=a.hidden&&!a.unlocked;return `<span title="${lh?'???':a.label}" style="font-size:17px;${a.unlocked?'':'opacity:0.2;filter:grayscale(1)'}">${lh?'❓':a.icon}</span>`;}).join('')}</div>
        <div style="font-size:11px;color:var(--text2)">${unlocked.length}/${achvs.length}</div></div>`;
    }).join('')+'</div>'}
  </div>`;
}

function renderCalendar() {
  const el = document.getElementById('calendar-content');
  if (!el) return;
  const y=calYear, m=calMonth;
  const firstDay=new Date(y,m,1).getDay();
  const daysInMonth=new Date(y,m+1,0).getDate();
  const daysInPrev=new Date(y,m,0).getDate();
  const weekdays=['일','월','화','수','목','금','토'];
  const ym=`${y}-${String(m+1).padStart(2,'0')}`;
  const monthBungs=bungs.filter(b=>b.date&&b.date.startsWith(ym));
  const isCurMonth = TODAY.getFullYear()===y && TODAY.getMonth()===m;
  let html=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <button class="btn btn-sm" onclick="calNav(-1)" aria-label="이전 달"><i class="ti ti-chevron-left"></i></button>
    <div class="flex" style="gap:8px"><div style="font-size:16px;font-weight:500">${y}년 ${m+1}월</div>${isCurMonth?'':'<button class="btn btn-sm" onclick="calToday()">오늘</button>'}</div>
    <button class="btn btn-sm" onclick="calNav(1)" aria-label="다음 달"><i class="ti ti-chevron-right"></i></button>
  </div>
  ${isAdmin?'<div style="font-size:11px;color:var(--text3);margin:-8px 0 10px;text-align:center">날짜를 누르면 그날 벙을 바로 추가할 수 있어요</div>':''}
  <div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem;margin-bottom:1rem">
    <div class="cal-grid" style="margin-bottom:4px">${weekdays.map(d=>`<div class="cal-header">${d}</div>`).join('')}</div>
    <div class="cal-grid">`;
  for(let i=firstDay-1;i>=0;i--) html+=`<div class="cal-day other-month"><div class="cal-day-num">${daysInPrev-i}</div></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const dateStr=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday=TODAY.getFullYear()===y&&TODAY.getMonth()===m&&TODAY.getDate()===d;
    const dayBungs=bungs.filter(b=>b.date===dateStr);
    html+=`<div class="cal-day${isToday?' today':''}${isAdmin?' clickable':''}"${isAdmin?` onclick="openAddBung('${dateStr}')"`:''}><div class="cal-day-num">${d}</div>${dayBungs.map(b=>`<div class="cal-event ${b.type==='번개'?'bungae':'jeongmo'}" onclick="event.stopPropagation();showCalBungDetail('${b.id}')" title="${esc(b.name)}">${esc(b.name)}</div>`).join('')}</div>`;
  }
  const remaining=(7-((firstDay+daysInMonth)%7))%7;
  for(let d=1;d<=remaining;d++) html+=`<div class="cal-day other-month"><div class="cal-day-num">${d}</div></div>`;
  html+=`</div></div>`;
  if(monthBungs.length>0){
    html+=`<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem">
      <div style="font-size:13px;font-weight:500;margin-bottom:10px">${m+1}월 벙 목록</div>
      ${monthBungs.sort((a,b)=>a.date.localeCompare(b.date)).map(b=>{
        const host=b.hostId?members.find(x=>x.id===b.hostId):null;
        const isPast=b.date<=todayStr();
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:0.5px solid var(--border);cursor:pointer" onclick="showCalBungDetail('${b.id}')">
          ${b.type==='번개'?'<span class="badge badge-bungae">번개</span>':'<span class="badge badge-jeongmo">정모</span>'}
          <div style="flex:1"><div style="font-size:13px;font-weight:500">${esc(b.name)}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${formatDate(b.date)}${b.place?` · ${esc(b.place)}`:''}${host?` · 벙주: ${esc(host.name)}`:''}</div></div>
          <div style="font-size:12px;color:var(--text2)">${isPast?(b.attendees||[]).length+'명':'예정'}</div></div>`;
      }).join('')}</div>`;
  }
  el.innerHTML=html;
}

function renderProfileList() {
  const el=document.getElementById('profile-content');
  if(!el)return;
  if(selectedMemberId){renderMemberProfile(selectedMemberId);return;}
  if(members.length===0){el.innerHTML='<div class="empty-state"><i class="ti ti-users"></i>등록된 회원이 없습니다.</div>';return;}
  const sorted=sortMembersByName(members);
  el.innerHTML=`<div style="margin-bottom:12px"><input type="search" id="profile-search-input" placeholder="이름·별명 검색" value="${esc(profileSearchQuery)}" oninput="filterProfileList(this.value)" style="width:100%;max-width:300px"></div>
  <div id="profile-list-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
    ${sorted.map(m=>{
      const attended=bungs.filter(b=>(b.attendees||[]).includes(m.id)).length;
      const rate=bungs.length>0?Math.round(attended/bungs.length*100):0;
      const grade=getMemberGrade(rate);
      const achvCount=getAchievements(m).filter(a=>a.unlocked).length;
      return `<div class="profile-grid-card" data-search="${esc(memberKeys(m).join('|'))}" onclick="openProfile('${m.id}')">
        ${m.photoURL?`<img src="${esc(m.photoURL)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;margin-bottom:8px">`:`<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--purple-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:500;margin-bottom:8px">${esc([...(m.name||'?')][0])}</div>`}
        <div style="font-size:13px;font-weight:500;margin-bottom:4px">${esc(m.name)}</div>
        <div style="font-size:11px;padding:2px 6px;border-radius:var(--radius);background:${grade.bg};color:${grade.color};font-weight:500;display:inline-block;margin-bottom:6px">${grade.label}</div>
        <div style="font-size:11px;color:var(--text2)">${rate}% · 업적 ${achvCount}개</div>
      </div>`;
    }).join('')}
  </div>`;
  if (profileSearchQuery) filterProfileList(profileSearchQuery);
}

function renderMemberProfile(id) {
  const m=members.find(x=>x.id===id);
  if(!m)return;
  const el=document.getElementById('profile-content');if(!el)return;
  const attended=bungs.filter(b=>(b.attendees||[]).includes(m.id));
  const rate=bungs.length>0?Math.round(attended.length/bungs.length*100):0;
  const grade=getMemberGrade(rate);
  const hosted=bungs.filter(b=>b.hostId===m.id);
  const achvs=getAchievements(m);
  const unlocked=achvs.filter(a=>a.unlocked);
  const daysSinceJoin=m.joinDate?daysBetween(parseDateStr(m.joinDate),parseDateStr(todayStr())):0;
  const sortedBungs=[...bungs].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  let maxStreak=0,curStreak=0;
  sortedBungs.forEach(b=>{if((b.attendees||[]).includes(m.id)){curStreak++;if(curStreak>maxStreak)maxStreak=curStreak;}else curStreak=0;});
  const monthlyData=[];
  for(let i=5;i>=0;i--){
    const d=new Date(TODAY.getFullYear(),TODAY.getMonth()-i,1);
    const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const mb=bungs.filter(b=>b.date&&b.date.startsWith(ym));
    monthlyData.push({label:`${d.getMonth()+1}월`,total:mb.length,attend:mb.filter(b=>(b.attendees||[]).includes(m.id)).length});
  }
  const maxMonthly=Math.max(...monthlyData.map(d=>d.total),1);
  const attendedBungs=[...attended].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const isMyProfile = currentUser && m.linkedUid === currentUser.uid;
  const aliases = memberAliases(m);
  el.innerHTML=`
  <div style="margin-bottom:12px;display:flex;justify-content:space-between"><button class="btn btn-sm" onclick="backToProfileList()"><i class="ti ti-arrow-left"></i> 목록으로</button>
  ${isMyProfile?`<button class="btn btn-sm btn-primary" onclick="openEditMyProfile('${m.id}')"><i class="ti ti-edit"></i> 내 프로필 수정</button>`:''}</div>
  <div class="profile-card">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
      ${m.photoURL?`<img src="${esc(m.photoURL)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;flex-shrink:0">`:`<div class="profile-avatar">${esc([...(m.name||'?')][0])}</div>`}
      <div><div style="font-size:20px;font-weight:500">${esc(m.name)}</div>
      ${aliases.length?`<div style="margin-top:3px">${aliases.map(a=>`<span class="alias-chip">${esc(a)}</span>`).join('')}</div>`:''}
      <div style="margin-top:4px"><span style="font-size:12px;padding:3px 10px;border-radius:20px;background:${grade.bg};color:${grade.color};font-weight:500">${grade.label}</span></div>
      ${m.memo?`<div style="font-size:12px;color:var(--text2);margin-top:6px">📝 ${esc(m.memo)}</div>`:''}
    </div></div>
    ${m.bio?`<div style="font-size:13px;line-height:1.7;background:var(--bg2);border-radius:var(--radius);padding:10px 12px;margin-bottom:12px">${esc(m.bio)}</div>`:''}
    ${(m.favSong||m.favArtist)?`<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text2);margin-bottom:12px">
      ${m.favArtist?`<span><i class="ti ti-microphone-2" style="color:var(--purple)"></i> 최애 아티스트: <strong style="color:var(--text)">${esc(m.favArtist)}</strong></span>`:''}
      ${m.favSong?`<span><i class="ti ti-music" style="color:var(--info)"></i> 최애곡: <strong style="color:var(--text)">${esc(m.favSong)}</strong></span>`:''}
    </div>`:''}
    <div class="profile-stat-grid">
      <div style="background:var(--bg2);border-radius:var(--radius);padding:10px;text-align:center"><div style="font-size:20px;font-weight:500;color:var(--info)">${rate}%</div><div style="font-size:11px;color:var(--text2);margin-top:2px">참여율</div></div>
      <div style="background:var(--bg2);border-radius:var(--radius);padding:10px;text-align:center"><div style="font-size:20px;font-weight:500">${attended.length}</div><div style="font-size:11px;color:var(--text2);margin-top:2px">참석 벙</div></div>
      <div style="background:var(--bg2);border-radius:var(--radius);padding:10px;text-align:center"><div style="font-size:20px;font-weight:500;color:var(--warn)">${maxStreak}</div><div style="font-size:11px;color:var(--text2);margin-top:2px">최장 연속</div></div>
      <div style="background:var(--bg2);border-radius:var(--radius);padding:10px;text-align:center"><div style="font-size:20px;font-weight:500;color:var(--purple)">${hosted.length}</div><div style="font-size:11px;color:var(--text2);margin-top:2px">벙주 횟수</div></div>
    </div>
    <div style="display:flex;gap:12px;margin-top:10px;font-size:12px;color:var(--text2)">
      <span><i class="ti ti-calendar" style="vertical-align:-1px"></i> 가입: ${formatDate(m.joinDate)}</span>
      <span><i class="ti ti-clock" style="vertical-align:-1px"></i> ${daysSinceJoin}일째 활동 중</span>
    </div>
  </div>
  <div class="profile-card">
    <div style="font-size:13px;font-weight:500;margin-bottom:12px">월별 참석 현황</div>
    <div style="display:flex;align-items:flex-end;gap:6px;height:80px;margin-bottom:6px">
      ${monthlyData.map(d=>{
        const barH=d.total>0?Math.round(d.total/maxMonthly*60):0;
        const attendH=d.total>0?Math.round(d.attend/d.total*barH):0;
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <div style="font-size:10px;color:var(--info);font-weight:500">${d.attend>0?d.attend:''}</div>
          <div style="width:100%;display:flex;flex-direction:column;justify-content:flex-end;height:60px">
            <div style="width:100%;background:var(--info);border-radius:3px 3px 0 0;height:${attendH}px"></div>
            <div style="width:100%;background:var(--bg3);height:${barH-attendH}px"></div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:6px">${monthlyData.map(d=>`<div style="flex:1;text-align:center;font-size:10px;color:var(--text2)">${d.label}</div>`).join('')}</div>
  </div>
  <div class="profile-card">
    <div style="font-size:13px;font-weight:500;margin-bottom:10px">출석 도장판 (전체 벙 ${sortedBungs.length}개 중 참석 ${attended.length}개)</div>
    ${sortedBungs.length===0?'<div style="font-size:13px;color:var(--text2)">아직 벙 기록이 없습니다.</div>':
    `<div style="display:flex;flex-wrap:wrap;gap:4px">${sortedBungs.map(b=>{
      const did=(b.attendees||[]).includes(m.id);
      return `<div title="${formatDate(b.date)} ${esc(b.name)}${did?' · 참석':' · 불참'}" style="width:13px;height:13px;border-radius:3px;background:${did?'var(--info)':'var(--bg3)'}"></div>`;
    }).join('')}</div>`}
  </div>
  ${(()=>{
    const coCounts={};
    bungs.forEach(b=>{
      if(!(b.attendees||[]).includes(m.id))return;
      (b.attendees||[]).forEach(oid=>{ if(oid===m.id)return; coCounts[oid]=(coCounts[oid]||0)+1; });
    });
    const coRanking=Object.entries(coCounts).map(([id,cnt])=>{
      const om=members.find(x=>x.id===id);
      return om?{name:om.name,photoURL:om.photoURL,count:cnt}:null;
    }).filter(Boolean).sort((a,b)=>b.count-a.count).slice(0,3);
    if(coRanking.length===0)return'';
    return `<div class="profile-card">
      <div style="font-size:13px;font-weight:500;margin-bottom:10px">🤝 같이 가장 많이 만난 멤버</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${coRanking.map((c,i)=>`<div style="display:flex;align-items:center;gap:8px;background:var(--bg2);border-radius:var(--radius);padding:8px 12px">
          <span style="font-size:13px">${['🥇','🥈','🥉'][i]}</span>
          ${c.photoURL?`<img src="${esc(c.photoURL)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`:`<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--purple-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500">${esc([...(c.name||'?')][0])}</div>`}
          <div><div style="font-size:12px;font-weight:500">${esc(c.name)}</div><div style="font-size:11px;color:var(--text2)">${c.count}번 같이 참석</div></div>
        </div>`).join('')}
      </div>
    </div>`;
  })()}
  <div class="profile-card">
    <div style="font-size:13px;font-weight:500;margin-bottom:10px">업적 (${unlocked.length}/${achvs.length})</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${achvs.map(a=>{
        const isLockedHidden = a.hidden && !a.unlocked;
        const icon = isLockedHidden ? '❓' : a.icon;
        const label = isLockedHidden ? '???' : a.label;
        const desc = isLockedHidden ? '아직 발견되지 않은 히든 업적' : a.desc;
        return `<div style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:var(--radius);background:${a.unlocked?'var(--warn-bg)':'var(--bg2)'};border:0.5px solid ${a.unlocked?'var(--warn-border)':'var(--border)'};${a.unlocked?'':'opacity:0.5'}">
        <span style="font-size:18px">${icon}</span>
        <div><div style="font-size:12px;font-weight:500;color:${a.unlocked?'var(--warn)':'var(--text2)'}">${label}</div><div style="font-size:11px;color:var(--text2)">${desc}</div></div>
      </div>`;
      }).join('')}
    </div>
    ${achvs.some(a=>a.hidden)?`<div style="font-size:11px;color:var(--text2);margin-top:8px">❓ 히든 업적은 달성 전까지 조건이 공개되지 않습니다.</div>`:''}
  </div>
  <div class="profile-card">
    <div style="font-size:13px;font-weight:500;margin-bottom:10px">참석 벙 목록 (${attended.length}개)</div>
    ${attendedBungs.length===0?'<div style="font-size:13px;color:var(--text2)">참석한 벙이 없습니다.</div>':
    `<div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow-x:auto">
      <table style="min-width:400px"><thead><tr><th>날짜</th><th>벙 이름</th><th>구분</th><th>장소</th></tr></thead><tbody>
      ${attendedBungs.slice(0,20).map(b=>`<tr>
        <td style="color:var(--text2)">${formatDate(b.date)}</td><td><strong>${esc(b.name)}</strong></td>
        <td>${b.type==='번개'?'<span class="badge badge-bungae">번개</span>':'<span class="badge badge-jeongmo">정모</span>'}</td>
        <td style="color:var(--text2)">${esc(b.place||'-')}</td></tr>`).join('')}
      </tbody></table></div>`}
  </div>
  <div class="profile-card">
    <div class="flex-between" style="margin-bottom:10px">
      <div style="font-size:13px;font-weight:500">💌 롤링페이퍼</div>
      <button class="btn btn-sm btn-primary" onclick="openAddRollingMessage('${m.id}')"><i class="ti ti-pencil"></i> 메시지 남기기</button>
    </div>
    <div id="rolling-paper-list"><div style="font-size:13px;color:var(--text2)">불러오는 중...</div></div>
  </div>`;
  loadRollingMessages(m.id);
}

let tournaments = [];
let activeTournamentUnsub = null;
let activeTournamentData = null;
async function loadTournaments() {
  try {
    const snap = await getDocs(query(collection(db,'tournaments'), orderBy('createdAt','desc')));
    tournaments = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e) { tournaments = []; }
  renderTournamentsCard();
}

function renderTournamentsCard() {
  const el = document.getElementById('tournament-card-content');
  if (!el) return;
  const ongoing = tournaments.filter(t=>t.status==='voting');
  const done = tournaments.filter(t=>t.status==='done').slice(0,5);
  el.innerHTML = `
    ${ongoing.length===0?'<div style="font-size:13px;color:var(--text2);margin-bottom:10px">진행 중인 토너먼트가 없습니다.</div>':
    ongoing.map(t=>{
      const roundNames=['16강','8강','4강','결승'];
      const totalRounds=Math.log2(t.candidates.length);
      const roundLabel=roundNames[totalRounds-1-((totalRounds-1)-t.currentRound)]||`${t.currentRound+1}라운드`;
      return `<div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg2);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <div style="min-width:0"><div style="font-size:13px;font-weight:500">🎶 ${esc(t.title)}</div><div style="font-size:11px;color:var(--text2);margin-top:2px">${roundLabel} 진행 중 · 후보 ${t.candidates.length}곡</div></div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-sm btn-primary" onclick="openTournamentVote('${t.id}')">투표하기</button>
          ${isAdmin?`<button class="btn btn-sm" onclick="advanceTournamentRound('${t.id}')">다음 라운드</button>`:''}
        </div>
      </div>`;
    }).join('')}
    ${isAdmin?`<button class="btn btn-sm" onclick="openCreateTournament()"><i class="ti ti-plus"></i> 새 토너먼트 시작</button>`:''}
    ${done.length>0?`<div style="font-size:12px;font-weight:500;color:var(--text2);margin-top:14px;margin-bottom:6px">역대 우승곡</div>
    ${done.map(t=>`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:0.5px solid var(--border)">
      <span style="font-size:18px">🏆</span>
      <div style="flex:1"><div style="font-size:13px;font-weight:500">${esc(t.winner?.songName||'-')}${t.winner?.artistName?` <span style="color:var(--text2);font-weight:400">- ${esc(t.winner.artistName)}</span>`:''}</div>
      <div style="font-size:11px;color:var(--text2)">${esc(t.title)}</div></div>
    </div>`).join('')}`:''}
  `;
}


let playgroundSubTab = 'idealcup';
function renderPlayground() {
  const el = document.getElementById('playground-content');
  if (!el) return;
  el.innerHTML = `
    <div class="flex" style="gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn btn-sm board-tab ${playgroundSubTab==='idealcup'?'active':''}" data-type="idealcup" onclick="switchPlaygroundTab('idealcup')"><i class="ti ti-trophy"></i> 이상형 월드컵</button>
      <button class="btn btn-sm board-tab ${playgroundSubTab==='tournament'?'active':''}" data-type="tournament" onclick="switchPlaygroundTab('tournament')"><i class="ti ti-music"></i> 노래 토너먼트</button>
    </div>
    <div id="playground-sub-content"></div>`;
  renderPlaygroundSubContent();
}

window.switchPlaygroundTab = function(tab) {
  playgroundSubTab = tab;
  document.querySelectorAll('#playground-content .board-tab').forEach(b => b.classList.toggle('active', b.dataset.type === tab));
  renderPlaygroundSubContent();
};

function renderPlaygroundSubContent() {
  const el = document.getElementById('playground-sub-content');
  if (!el) return;
  if (playgroundSubTab === 'idealcup') {
    loadIdealCups();
    return;
  }
  el.innerHTML = `<div class="hall-card"><h3>🎶 노래 토너먼트</h3>
    <div id="tournament-card-content"><div style="font-size:13px;color:var(--text2)">불러오는 중...</div></div>
  </div>`;
  loadTournaments();
}

function getUniqueSongPool() {
  const pool = getSongPool();
  const seen = new Set();
  const unique = [];
  pool.forEach(p=>{
    const key=(p.songName||'').trim().toLowerCase()+'|'+(p.artistName||'').trim().toLowerCase();
    if(!(p.songName||'').trim() || seen.has(key)) return;
    seen.add(key); unique.push(p);
  });
  return unique;
}

let _tnPool = [];
window.openCreateTournament = function() {
  if (!isAdmin) return;
  _tnPool = getUniqueSongPool().filter(p=>getYoutubeId(p.youtubeUrl));
  if (_tnPool.length<2) { alert('유튜브 링크가 등록된 추천곡이 2곡 이상 필요합니다. 플레이리스트나 노래 추천 게시판에서 곡 등록 시 유튜브 링크를 함께 입력해주세요.'); return; }
  openModal(`<div class="modal-title">🎶 노래 이상형월드컵 시작</div>
    <input type="text" id="tn-title" placeholder="토너먼트 이름 (예: 2026년 6월 이상형월드컵)" style="width:100%;margin-bottom:10px">
    <div style="font-size:12px;color:var(--text2);margin-bottom:8px">참가곡을 선택하세요. 선택한 개수 중 2의 거듭수(최대 16곡)로 잘라 진행됩니다. (유튜브 링크가 등록된 곡만 표시됩니다)</div>
    <div style="max-height:260px;overflow-y:auto;border:0.5px solid var(--border);border-radius:var(--radius);padding:8px;margin-bottom:14px">
      ${_tnPool.map((p,i)=>`<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;font-size:13px">
        <input type="checkbox" class="tn-song-check" value="${i}">
        <span>${esc(p.songName)}${p.artistName?` <span style="color:var(--text2)">- ${esc(p.artistName)}</span>`:''}</span>
      </label>`).join('')}
    </div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button>
    <button class="btn btn-primary" onclick="createTournamentConfirm()">시작</button></div>`);
};

window.createTournamentConfirm = async function() {
  const title = document.getElementById('tn-title').value.trim() || '노래 이상형월드컵';
  const checked = [...document.querySelectorAll('.tn-song-check:checked')].map(c=>parseInt(c.value));
  if (checked.length<2) { alert('2곡 이상 선택해주세요.'); return; }
  let selected = checked.map(i=>_tnPool[i]);
  for (let i=selected.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [selected[i],selected[j]]=[selected[j],selected[i]]; }
  let bracketSize=1;
  while (bracketSize*2<=selected.length && bracketSize*2<=16) bracketSize*=2;
  selected = selected.slice(0,bracketSize);
  const round0 = [];
  for (let i=0;i<selected.length;i+=2) {
    round0.push({a:{songName:selected[i].songName,artistName:selected[i].artistName||'',youtubeUrl:selected[i].youtubeUrl||''}, b:{songName:selected[i+1].songName,artistName:selected[i+1].artistName||'',youtubeUrl:selected[i+1].youtubeUrl||''}, votes:{}});
  }
  try {
    await addDoc(collection(db,'tournaments'), {
      title, candidates: selected.map(s=>({songName:s.songName,artistName:s.artistName||'',youtubeUrl:s.youtubeUrl||''})),
      rounds:[{matches:round0}], currentRound:0, status:'voting', winner:null, createdAt: serverTimestamp()
    });
    closeModal();
    loadTournaments();
  } catch(e) { alert('토너먼트 생성 중 오류가 발생했습니다: ' + e.message); }
};

window.openTournamentVote = function(id) {
  if (activeTournamentUnsub) { activeTournamentUnsub(); activeTournamentUnsub=null; }
  activeTournamentUnsub = onSnapshot(doc(db,'tournaments',id), snap=>{
    if (!snap.exists()) return;
    activeTournamentData = {id:snap.id, ...snap.data()};
    renderTournamentVoteModal();
  });
};

function renderTournamentVoteModal() {
  const t = activeTournamentData;
  if (!t) return;
  const round = (t.rounds[t.currentRound] || {}).matches || [];
  const totalRounds = Math.log2(t.candidates.length);
  const remaining = totalRounds - t.currentRound;
  const roundNames = {1:'결승',2:'4강',3:'8강',4:'16강'};
  const roundLabel = roundNames[remaining] || `${t.currentRound+1}라운드`;
  const myUid = currentUser ? currentUser.uid : null;
  const html = `<div class="modal-title">🎶 ${esc(t.title)} · ${roundLabel}</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
    ${round.map((match,mi)=>{
      const votesA = Object.values(match.votes||{}).filter(v=>v==='a').length;
      const votesB = Object.values(match.votes||{}).filter(v=>v==='b').length;
      const myVote = myUid ? (match.votes||{})[myUid] : null;
      return `<div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;display:flex;flex-direction:column;gap:4px">
            <button class="btn btn-sm" style="text-align:left;${myVote==='a'?'background:var(--info-bg);border-color:var(--info)':''}" onclick="castTournamentVote('${t.id}',${mi},'a')">
              ${esc(match.a.songName)}${match.a.artistName?` <span style="color:var(--text2);font-size:11px">- ${esc(match.a.artistName)}</span>`:''}<br><span style="font-size:11px;color:var(--text2)">${votesA}표</span>
            </button>
            ${match.a.youtubeUrl?`<button class="btn btn-sm" style="font-size:11px" onclick="toggleTournamentPlayer('tn-yt-${mi}a','${getYoutubeId(match.a.youtubeUrl)}')"><i class="ti ti-player-play"></i> 들어보기</button><div id="tn-yt-${mi}a"></div>`:''}
          </div>
          <span style="font-size:11px;color:var(--text2)">VS</span>
          <div style="flex:1;display:flex;flex-direction:column;gap:4px">
            <button class="btn btn-sm" style="text-align:left;${myVote==='b'?'background:var(--info-bg);border-color:var(--info)':''}" onclick="castTournamentVote('${t.id}',${mi},'b')">
              ${esc(match.b.songName)}${match.b.artistName?` <span style="color:var(--text2);font-size:11px">- ${esc(match.b.artistName)}</span>`:''}<br><span style="font-size:11px;color:var(--text2)">${votesB}표</span>
            </button>
            ${match.b.youtubeUrl?`<button class="btn btn-sm" style="font-size:11px" onclick="toggleTournamentPlayer('tn-yt-${mi}b','${getYoutubeId(match.b.youtubeUrl)}')"><i class="ti ti-player-play"></i> 들어보기</button><div id="tn-yt-${mi}b"></div>`:''}
          </div>
        </div>
      </div>`;
    }).join('')}
    </div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px">곡을 클릭해서 투표하세요. 다시 클릭하면 투표를 바꿀 수 있습니다.</div>
    <div class="flex" style="justify-content:flex-end"><button class="btn" onclick="closeTournamentVoteModal()">닫기</button></div>`;
  openModal(html);
}

window.toggleTournamentPlayer = function(containerId, videoId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const wasOpen = !!el.innerHTML;
  // 다른 곡이 재생 중이면 먼저 정지 (여러 곡 동시 재생 방지)
  document.querySelectorAll('[id^="tn-yt-"]').forEach(other => {
    if (other.id !== containerId) other.innerHTML = '';
  });
  if (wasOpen) { el.innerHTML = ''; return; }
  el.innerHTML = `<iframe width="100%" height="160" src="https://www.youtube.com/embed/${videoId}?autoplay=1" title="YouTube player" style="border:none;border-radius:var(--radius);margin-top:4px" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
};

window.castTournamentVote = async function(id, matchIdx, choice) {
  if (!currentUser) { requireLogin('투표하려면 로그인이 필요합니다.'); return; }
  const t = activeTournamentData;
  if (!t || t.id!==id) return;
  const rounds = JSON.parse(JSON.stringify(t.rounds));
  const match = rounds[t.currentRound].matches[matchIdx];
  if (!match.votes) match.votes={};
  match.votes[currentUser.uid] = choice;
  try { await updateDoc(doc(db,'tournaments',id), {rounds}); }
  catch(e) { alert('투표 중 오류가 발생했습니다: ' + e.message); }
};

window.closeTournamentVoteModal = function() {
  if (activeTournamentUnsub) { activeTournamentUnsub(); activeTournamentUnsub=null; }
  activeTournamentData = null;
  closeModal();
};

window.advanceTournamentRound = async function(id) {
  if (!isAdmin) return;
  if (!confirm('현재 라운드 투표를 마감하고 다음 라운드로 진행할까요?')) return;
  const tdoc = await getDoc(doc(db,'tournaments',id));
  if (!tdoc.exists()) return;
  const t = {id:tdoc.id, ...tdoc.data()};
  const round = t.rounds[t.currentRound].matches;
  const winners = round.map(match=>{
    const votesA = Object.values(match.votes||{}).filter(v=>v==='a').length;
    const votesB = Object.values(match.votes||{}).filter(v=>v==='b').length;
    if (votesA===votesB) return Math.random()<0.5?match.a:match.b;
    return votesA>votesB?match.a:match.b;
  });
  try {
    if (winners.length===1) {
      await updateDoc(doc(db,'tournaments',id), {status:'done', winner: winners[0]});
      alert(`🏆 우승곡: ${winners[0].songName}`);
    } else {
      const nextRound=[];
      for (let i=0;i<winners.length;i+=2) nextRound.push({a:winners[i], b:winners[i+1], votes:{}});
      const rounds=[...t.rounds, {matches:nextRound}];
      await updateDoc(doc(db,'tournaments',id), {rounds, currentRound: t.currentRound+1});
    }
    loadTournaments();
  } catch(e) { alert('라운드 진행 중 오류가 발생했습니다: ' + e.message); }
};

// ── 이상형 월드컵 ─────────────────────────────────────────────────
let idealCups = [];
let icSortMode = 'recent'; // 'popular' | 'recent'
let _icDraftLineups = [];
let _icDraftCounter = 0;

async function loadIdealCups() {
  const el = document.getElementById('playground-sub-content');
  if (el) el.innerHTML = `<div style="font-size:13px;color:var(--text2)">불러오는 중...</div>`;
  try {
    const snap = await getDocs(query(collection(db,'idealCups'), orderBy('createdAt','desc')));
    idealCups = snap.docs.map(d=>({id:d.id, ...d.data()}));
  } catch(e) { idealCups = []; }
  renderIdealCupList();
}

function renderIdealCupList() {
  const el = document.getElementById('playground-sub-content');
  if (!el) return;
  const sorted = [...idealCups].sort((a,b)=> icSortMode==='popular'
    ? (b.plays||0)-(a.plays||0)
    : (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  el.innerHTML = `
    <div class="flex-between" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div class="flex" style="gap:6px">
        <button class="btn btn-sm ${icSortMode==='popular'?'btn-primary':''}" onclick="setIcSortMode('popular')">인기순</button>
        <button class="btn btn-sm ${icSortMode==='recent'?'btn-primary':''}" onclick="setIcSortMode('recent')">최신순</button>
      </div>
      <button class="btn btn-sm btn-primary" onclick="openCreateIdealCup()"><i class="ti ti-plus"></i> 월드컵 만들기</button>
      ${currentUser?`<button class="btn btn-sm" onclick="openIdealCupDraftViewer()"><i class="ti ti-notes"></i> 임시저장 확인</button>`:''}
    </div>
    ${sorted.length===0
      ? `<div class="empty-state"><i class="ti ti-trophy"></i>아직 만들어진 이상형월드컵이 없습니다.</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px">${sorted.map(c=>renderIdealCupCard(c)).join('')}</div>`}
  `;
}

window.setIcSortMode = function(mode) { icSortMode = mode; renderIdealCupList(); };

function renderIdealCupCard(c) {
  const thumbs = shuffleArray(c.lineups||[]).slice(0,2);
  const canManage = isAdmin || (currentUser && c.creatorUid===currentUser.uid);
  const isCreator = currentUser && c.creatorUid===currentUser.uid;
  return `<div class="hall-card" style="padding:0;overflow:hidden">
    <div style="display:flex;height:160px">
      ${thumbs.map(t=>`<div style="flex:1;background:var(--bg2);overflow:hidden;display:flex;align-items:center;justify-content:center">
        ${t.imageUrl?`<img src="${esc(t.imageUrl)}" style="width:100%;height:100%;object-fit:contain" loading="lazy">`:t.youtubeUrl?`<i class="ti ti-brand-youtube" style="color:var(--text2);font-size:20px"></i>`:`<i class="ti ti-photo-off" style="color:var(--text2);font-size:20px"></i>`}
      </div>`).join('')}
    </div>
    <div style="padding:10px 12px">
      <div style="font-size:13px;font-weight:600;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.description||'')}</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px">참가 ${(c.lineups||[]).length}개 · ${esc(resolveAuthorName(c.creatorUid, c.creatorName))}</div>
      <div class="flex" style="gap:6px;flex-wrap:nowrap">
        <button class="btn btn-sm btn-primary" style="white-space:nowrap" onclick="openIdealCupPlay('${c.id}')"><i class="ti ti-player-play"></i> 시작</button>
        <button class="btn btn-sm" style="white-space:nowrap" onclick="openIdealCupRanking('${c.id}')"><i class="ti ti-list"></i> 랭킹</button>
        <button class="btn btn-sm" style="white-space:nowrap" onclick="openIdealCupComments('${c.id}')"><i class="ti ti-message-circle"></i> 댓글</button>
        ${isCreator?`<button class="btn btn-sm" style="flex:0 0 auto" onclick="openEditIdealCup('${c.id}')"><i class="ti ti-pencil"></i></button>`:''}
        ${canManage?`<button class="btn btn-sm btn-danger" style="flex:0 0 auto" onclick="deleteIdealCup('${c.id}')"><i class="ti ti-trash"></i></button>`:''}
      </div>
    </div>
  </div>`;
}

window.deleteIdealCup = async function(id) {
  if (!confirm('이 이상형월드컵을 삭제할까요? 등록된 사진도 함께 삭제됩니다.')) return;
  try {
    await deleteDoc(doc(db,'idealCups',id));
    try {
      const folderRef = ref(storage, `idealcups/${id}`);
      const list = await listAll(folderRef);
      await Promise.all(list.items.map(item=>deleteObject(item)));
    } catch(e) {}
    loadIdealCups();
  } catch(e) { alert('삭제 중 오류가 발생했습니다: ' + e.message); }
};

function loadIdealCupDraftIntoState(d) {
  _icDraftLineups = []; _icDraftCounter = 0;
  (d.lineups||[]).forEach(l=>{
    _icDraftCounter++;
    _icDraftLineups.push({ id: l.id || ('L'+_icDraftCounter), name: l.name, desc: l.desc||'', file: null, youtubeUrl: l.youtubeUrl||'', imageUrl: l.imageUrl||'', previewUrl: l.imageUrl||null });
  });
}

function openIdealCupCreateModal(draftTitle, draftDesc) {
  _icUnsavedActive = true;
  openModal(`<div class="modal-title">🏆 이상형월드컵 만들기</div>
    <input type="text" id="ic-title" placeholder="제목 (예: J-pop 솔로 가수 이상형월드컵)" value="${esc(draftTitle||'')}" style="width:100%;margin-bottom:8px">
    <textarea id="ic-desc" placeholder="간단한 설명" style="width:100%;min-height:50px;margin-bottom:14px">${esc(draftDesc||'')}</textarea>
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">라인업 추가 <span id="ic-lineup-count" style="color:var(--text2);font-weight:400">0개</span></div>
    <div style="border:0.5px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:10px">
      <input type="text" id="ic-ln-name" placeholder="이름 (예: 유우리, 또는 김치찌개를 끓이는 티라노사우르스)" style="width:100%;margin-bottom:6px">
      <div style="font-size:11px;color:var(--text2);margin-bottom:4px">사진 첨부 / 이미지 링크 / 유튜브 링크 중 하나를 입력해주세요.</div>
      <div class="flex" style="gap:6px;margin-bottom:6px;flex-wrap:wrap">
        <input type="file" id="ic-ln-file" accept="image/*" style="flex:1;min-width:120px;font-size:12px">
        <input type="text" id="ic-ln-imgurl" placeholder="이미지 링크 (URL)" style="flex:1;min-width:120px">
        <input type="text" id="ic-ln-yt" placeholder="유튜브 링크" style="flex:1;min-width:120px">
      </div>
      <button class="btn btn-sm" onclick="addIdealCupLineupDraft()"><i class="ti ti-plus"></i> 라인업에 추가</button>
    </div>
    <div id="ic-lineup-list" style="max-height:200px;overflow-y:auto;border:0.5px solid var(--border);border-radius:var(--radius);padding:6px;margin-bottom:14px">
      <div style="font-size:12px;color:var(--text2)">아직 추가된 라인업이 없습니다.</div>
    </div>
    <div class="flex" style="justify-content:flex-end;gap:8px">
      <button class="btn" onclick="closeModal()">취소</button>
      <button class="btn" id="ic-draft-btn" onclick="saveIdealCupDraft()"><i class="ti ti-device-floppy"></i> 임시저장</button>
      <button class="btn btn-primary" id="ic-submit-btn" onclick="submitIdealCup()">만들기</button>
    </div>`);
  renderIdealCupDraftList();
}

window.openCreateIdealCup = async function() {
  if (!currentUser) { requireLogin('이상형월드컵을 만들려면 로그인이 필요합니다.'); return; }
  _icDraftLineups = []; _icDraftCounter = 0;
  let draftTitle = '', draftDesc = '';
  try {
    const dsnap = await getDoc(doc(db,'idealCupDrafts',currentUser.uid));
    if (dsnap.exists() && confirm('작성 중이던 임시저장본이 있습니다. 불러올까요? ("취소"를 누르면 새로 시작합니다)')) {
      const d = dsnap.data();
      draftTitle = d.title || ''; draftDesc = d.description || '';
      loadIdealCupDraftIntoState(d);
    }
  } catch(e) {}
  openIdealCupCreateModal(draftTitle, draftDesc);
};

window.openIdealCupDraftViewer = async function() {
  if (!currentUser) { requireLogin('임시저장 확인에는 로그인이 필요합니다.'); return; }
  openModal(`<div class="modal-title">📝 임시저장</div><div style="font-size:13px;color:var(--text2)">불러오는 중...</div>`);
  let dsnap;
  try { dsnap = await getDoc(doc(db,'idealCupDrafts',currentUser.uid)); }
  catch(e) { closeModal(); alert('임시저장을 불러오지 못했습니다: ' + e.message); return; }
  if (!dsnap.exists()) {
    openModal(`<div class="modal-title">📝 임시저장</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:14px">저장된 임시저장본이 없습니다.</div>
      <div class="flex" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">닫기</button></div>`);
    return;
  }
  const d = dsnap.data();
  const lineups = d.lineups || [];
  const updated = d.updatedAt ? new Date(d.updatedAt.seconds*1000) : null;
  openModal(`<div class="modal-title">📝 임시저장</div>
    <div style="font-size:14px;font-weight:600;margin-bottom:4px">${esc(d.title || '(제목 없음)')}</div>
    ${d.description?`<div style="font-size:12px;color:var(--text2);margin-bottom:8px">${esc(d.description)}</div>`:''}
    <div style="font-size:11px;color:var(--text2);margin-bottom:12px">라인업 ${lineups.length}개${updated?' · '+formatDate(updated)+' 저장':''}</div>
    <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:16px;padding-bottom:4px">
      ${lineups.map(l=>`<div style="flex-shrink:0;width:48px;height:48px;border-radius:6px;overflow:hidden;background:var(--bg2);display:flex;align-items:center;justify-content:center">${l.imageUrl?`<img src="${esc(l.imageUrl)}" style="width:100%;height:100%;object-fit:cover">`:l.youtubeUrl?'<i class="ti ti-brand-youtube" style="color:var(--text2);font-size:14px"></i>':'<i class="ti ti-photo-off" style="color:var(--text2);font-size:14px"></i>'}</div>`).join('')}
    </div>
    <div class="flex" style="justify-content:flex-end;gap:8px">
      <button class="btn btn-danger" onclick="deleteIdealCupDraft()">삭제</button>
      <button class="btn" onclick="closeModal()">닫기</button>
      <button class="btn btn-primary" onclick="resumeIdealCupDraft()">이어서 작성</button>
    </div>`);
};

window.resumeIdealCupDraft = async function() {
  if (!currentUser) return;
  let dsnap;
  try { dsnap = await getDoc(doc(db,'idealCupDrafts',currentUser.uid)); }
  catch(e) { alert('임시저장을 불러오지 못했습니다: ' + e.message); return; }
  if (!dsnap.exists()) { closeModal(); return; }
  const d = dsnap.data();
  loadIdealCupDraftIntoState(d);
  openIdealCupCreateModal(d.title||'', d.description||'');
};

window.deleteIdealCupDraft = async function() {
  if (!currentUser) return;
  if (!confirm('임시저장본을 삭제할까요?')) return;
  try {
    await deleteDoc(doc(db,'idealCupDrafts',currentUser.uid));
    closeModal();
  } catch(e) { alert('삭제 중 오류가 발생했습니다: ' + e.message); }
};

window.addIdealCupLineupDraft = function() {
  const name = document.getElementById('ic-ln-name').value.trim();
  if (!name) { alert('라인업 이름을 입력해주세요.'); return; }
  const fileInput = document.getElementById('ic-ln-file');
  const file = fileInput.files[0] || null;
  const imgUrlRaw = document.getElementById('ic-ln-imgurl').value.trim();
  const ytRaw = document.getElementById('ic-ln-yt').value.trim();
  const filledCount = [file, imgUrlRaw, ytRaw].filter(Boolean).length;
  if (filledCount > 1) { alert('사진 첨부 / 이미지 링크 / 유튜브 링크 중 하나만 입력해주세요.'); return; }
  if (filledCount === 0) { alert('사진을 첨부하거나, 이미지 링크 또는 유튜브 링크를 입력해주세요.'); return; }
  let youtubeUrl = '', imageUrl = '';
  if (ytRaw) {
    if (!getYoutubeId(ytRaw)) { alert('유효한 유튜브 링크가 아닙니다.'); return; }
    youtubeUrl = ytRaw;
  } else if (imgUrlRaw) {
    if (!/^https?:\/\//i.test(imgUrlRaw)) { alert('유효한 이미지 링크(URL)가 아닙니다.'); return; }
    imageUrl = imgUrlRaw;
  }
  const id = 'L' + (++_icDraftCounter);
  const previewUrl = file ? URL.createObjectURL(file) : (imageUrl || null);
  _icDraftLineups.push({ id, name, desc:'', file, youtubeUrl, imageUrl, previewUrl });
  document.getElementById('ic-ln-name').value = '';
  fileInput.value = '';
  document.getElementById('ic-ln-imgurl').value = '';
  document.getElementById('ic-ln-yt').value = '';
  renderIdealCupDraftList();
};

function renderIdealCupDraftList() {
  const el = document.getElementById('ic-lineup-list');
  if (!el) return;
  el.innerHTML = _icDraftLineups.length === 0
    ? `<div style="font-size:12px;color:var(--text2)">아직 추가된 라인업이 없습니다.</div>`
    : _icDraftLineups.map((l,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:6px;border-bottom:0.5px solid var(--border)">
        ${l.previewUrl
          ? `<img src="${esc(l.previewUrl)}" style="width:36px;height:36px;border-radius:6px;object-fit:cover">`
          : l.youtubeUrl
            ? `<div style="width:36px;height:36px;border-radius:6px;background:var(--bg2);display:flex;align-items:center;justify-content:center"><i class="ti ti-brand-youtube" style="font-size:16px;color:var(--text2)"></i></div>`
            : `<div style="width:36px;height:36px;border-radius:6px;background:var(--bg2);display:flex;align-items:center;justify-content:center"><i class="ti ti-photo-off" style="font-size:16px;color:var(--text2)"></i></div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500">${esc(l.name)}</div>
          ${l.desc?`<div style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.desc)}</div>`:''}
        </div>
        <span style="cursor:pointer;color:var(--text2);padding:0 4px" onclick="removeIdealCupLineupDraft(${i})">×</span>
      </div>`).join('');
  const countEl = document.getElementById('ic-lineup-count');
  if (countEl) countEl.textContent = `${_icDraftLineups.length}개`;
}

window.removeIdealCupLineupDraft = function(i) {
  _icDraftLineups.splice(i, 1);
  renderIdealCupDraftList();
};

window.submitIdealCup = async function() {
  const title = document.getElementById('ic-title').value.trim();
  const description = document.getElementById('ic-desc').value.trim();
  if (!title) { alert('제목을 입력해주세요.'); return; }
  if (_icDraftLineups.length < 2) { alert('라인업은 2개 이상 등록해야 합니다.'); return; }
  const btn = document.getElementById('ic-submit-btn');
  btn.disabled = true;
  try {
    const cupRef = doc(collection(db,'idealCups'));
    const lineups = [];
    for (let i=0; i<_icDraftLineups.length; i++) {
      const l = _icDraftLineups[i];
      let imageUrl = l.imageUrl || '';
      if (l.file) {
        btn.textContent = `업로드 중... (${i+1}/${_icDraftLineups.length})`;
        const storageRef = ref(storage, `idealcups/${cupRef.id}/${l.id}_${Date.now()}`);
        await uploadBytes(storageRef, l.file);
        imageUrl = await getDownloadURL(storageRef);
      }
      lineups.push({ id:l.id, name:l.name, desc:l.desc, imageUrl, youtubeUrl:l.youtubeUrl||'', wins:0, matches:0, championCount:0 });
    }
    await setDoc(cupRef, {
      title, description, lineups,
      creatorUid: currentUser.uid, creatorName: authorDisplayName(),
      createdAt: serverTimestamp(), plays: 0
    });
    _icDraftLineups = [];
    try { await deleteDoc(doc(db,'idealCupDrafts',currentUser.uid)); } catch(e) {}
    _icUnsavedActive = false;
    closeModal();
    loadIdealCups();
  } catch(e) {
    alert('이상형월드컵 생성 중 오류가 발생했습니다: ' + e.message);
    btn.disabled = false; btn.textContent = '만들기';
  }
};

window.saveIdealCupDraft = async function() {
  if (!currentUser) { requireLogin('임시저장에는 로그인이 필요합니다.'); return; }
  const title = document.getElementById('ic-title').value.trim();
  const description = document.getElementById('ic-desc').value.trim();
  const btn = document.getElementById('ic-draft-btn');
  btn.disabled = true; btn.textContent = '저장 중...';
  try {
    for (let i=0; i<_icDraftLineups.length; i++) {
      const l = _icDraftLineups[i];
      if (l.file && !l.imageUrl) {
        btn.textContent = `사진 업로드 중... (${i+1}/${_icDraftLineups.length})`;
        const storageRef = ref(storage, `idealcups_drafts/${currentUser.uid}/${l.id}_${Date.now()}`);
        await uploadBytes(storageRef, l.file);
        l.imageUrl = await getDownloadURL(storageRef);
        l.file = null;
      }
    }
    const lineups = _icDraftLineups.map(l => ({ id:l.id, name:l.name, desc:l.desc, imageUrl:l.imageUrl||'', youtubeUrl:l.youtubeUrl||'' }));
    await setDoc(doc(db,'idealCupDrafts',currentUser.uid), { title, description, lineups, updatedAt: serverTimestamp() });
    alert('임시저장 되었습니다. 다음에 "월드컵 만들기"를 누르면 이어서 작성할 수 있어요.');
  } catch(e) {
    alert('임시저장 중 오류가 발생했습니다: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '임시저장';
  }
};

// ── 이상형 월드컵 · 수정 (제작자 본인만) ───────────────────────────────
let _icEditCupId = null;
let _icEditLineups = [];
let _icEditCounter = 0;

window.openEditIdealCup = function(cupId) {
  const cup = idealCups.find(c=>c.id===cupId);
  if (!cup) return;
  if (!currentUser || cup.creatorUid !== currentUser.uid) { alert('제작자 본인만 수정할 수 있습니다.'); return; }
  _icEditCupId = cupId;
  _icEditLineups = (cup.lineups||[]).map(l=>({
    id: l.id, name: l.name, desc: l.desc||'', file: null,
    youtubeUrl: l.youtubeUrl||'', imageUrl: l.imageUrl||'', previewUrl: l.imageUrl||null,
    wins: l.wins||0, matches: l.matches||0, championCount: l.championCount||0
  }));
  _icEditCounter = 0;
  _icUnsavedActive = true;
  openModal(`<div class="modal-title">✏️ 이상형월드컵 수정</div>
    <input type="text" id="ic-edit-title" placeholder="제목" value="${esc(cup.title||'')}" style="width:100%;margin-bottom:8px">
    <textarea id="ic-edit-desc" placeholder="간단한 설명" style="width:100%;min-height:50px;margin-bottom:14px">${esc(cup.description||'')}</textarea>
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px">⚠️ 라인업을 삭제하면 그동안 쌓인 투표 기록(승수/우승 횟수)도 함께 사라집니다.</div>
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">라인업 추가 <span id="ic-edit-lineup-count" style="color:var(--text2);font-weight:400">0개</span></div>
    <div style="border:0.5px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:10px">
      <input type="text" id="ic-edit-ln-name" placeholder="이름 (예: 유우리, 또는 김치찌개를 끓이는 티라노사우르스)" style="width:100%;margin-bottom:6px">
      <div style="font-size:11px;color:var(--text2);margin-bottom:4px">사진 첨부 / 이미지 링크 / 유튜브 링크 중 하나를 입력해주세요.</div>
      <div class="flex" style="gap:6px;margin-bottom:6px;flex-wrap:wrap">
        <input type="file" id="ic-edit-ln-file" accept="image/*" style="flex:1;min-width:120px;font-size:12px">
        <input type="text" id="ic-edit-ln-imgurl" placeholder="이미지 링크 (URL)" style="flex:1;min-width:120px">
        <input type="text" id="ic-edit-ln-yt" placeholder="유튜브 링크" style="flex:1;min-width:120px">
      </div>
      <button class="btn btn-sm" onclick="addIdealCupLineupEdit()"><i class="ti ti-plus"></i> 라인업에 추가</button>
    </div>
    <div id="ic-edit-lineup-list" style="max-height:200px;overflow-y:auto;border:0.5px solid var(--border);border-radius:var(--radius);padding:6px;margin-bottom:14px"></div>
    <div class="flex" style="justify-content:flex-end;gap:8px">
      <button class="btn" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" id="ic-edit-submit-btn" onclick="submitIdealCupEdit()">저장</button>
    </div>`);
  renderIdealCupEditList();
};

window.addIdealCupLineupEdit = function() {
  const name = document.getElementById('ic-edit-ln-name').value.trim();
  if (!name) { alert('라인업 이름을 입력해주세요.'); return; }
  const fileInput = document.getElementById('ic-edit-ln-file');
  const file = fileInput.files[0] || null;
  const imgUrlRaw = document.getElementById('ic-edit-ln-imgurl').value.trim();
  const ytRaw = document.getElementById('ic-edit-ln-yt').value.trim();
  const filledCount = [file, imgUrlRaw, ytRaw].filter(Boolean).length;
  if (filledCount > 1) { alert('사진 첨부 / 이미지 링크 / 유튜브 링크 중 하나만 입력해주세요.'); return; }
  if (filledCount === 0) { alert('사진을 첨부하거나, 이미지 링크 또는 유튜브 링크를 입력해주세요.'); return; }
  let youtubeUrl = '', imageUrl = '';
  if (ytRaw) {
    if (!getYoutubeId(ytRaw)) { alert('유효한 유튜브 링크가 아닙니다.'); return; }
    youtubeUrl = ytRaw;
  } else if (imgUrlRaw) {
    if (!/^https?:\/\//i.test(imgUrlRaw)) { alert('유효한 이미지 링크(URL)가 아닙니다.'); return; }
    imageUrl = imgUrlRaw;
  }
  const id = 'E' + Date.now() + '_' + (++_icEditCounter);
  const previewUrl = file ? URL.createObjectURL(file) : (imageUrl || null);
  _icEditLineups.push({ id, name, desc:'', file, youtubeUrl, imageUrl, previewUrl, wins:0, matches:0, championCount:0 });
  document.getElementById('ic-edit-ln-name').value = '';
  fileInput.value = '';
  document.getElementById('ic-edit-ln-imgurl').value = '';
  document.getElementById('ic-edit-ln-yt').value = '';
  renderIdealCupEditList();
};

function renderIdealCupEditList() {
  const el = document.getElementById('ic-edit-lineup-list');
  if (!el) return;
  el.innerHTML = _icEditLineups.length === 0
    ? `<div style="font-size:12px;color:var(--text2)">라인업이 없습니다. 2개 이상 있어야 합니다.</div>`
    : _icEditLineups.map((l,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:6px;border-bottom:0.5px solid var(--border)">
        ${l.previewUrl
          ? `<img src="${esc(l.previewUrl)}" style="width:36px;height:36px;border-radius:6px;object-fit:cover">`
          : l.youtubeUrl
            ? `<div style="width:36px;height:36px;border-radius:6px;background:var(--bg2);display:flex;align-items:center;justify-content:center"><i class="ti ti-brand-youtube" style="font-size:16px;color:var(--text2)"></i></div>`
            : `<div style="width:36px;height:36px;border-radius:6px;background:var(--bg2);display:flex;align-items:center;justify-content:center"><i class="ti ti-photo-off" style="font-size:16px;color:var(--text2)"></i></div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500">${esc(l.name)}</div>
          ${l.matches>0?`<div style="font-size:11px;color:var(--text2)">${l.matches}전 ${l.wins}승 · 우승 ${l.championCount}회</div>`:''}
        </div>
        <span style="cursor:pointer;color:var(--text2);padding:0 4px" onclick="removeIdealCupLineupEdit(${i})">×</span>
      </div>`).join('');
  const countEl = document.getElementById('ic-edit-lineup-count');
  if (countEl) countEl.textContent = `${_icEditLineups.length}개`;
}

window.removeIdealCupLineupEdit = function(i) {
  const l = _icEditLineups[i];
  if (l.matches > 0) {
    if (!confirm(`"${l.name}"은(는) 투표 기록이 있습니다. 삭제하면 해당 기록도 함께 사라집니다. 삭제할까요?`)) return;
  }
  _icEditLineups.splice(i, 1);
  renderIdealCupEditList();
};

window.submitIdealCupEdit = async function() {
  const title = document.getElementById('ic-edit-title').value.trim();
  const description = document.getElementById('ic-edit-desc').value.trim();
  if (!title) { alert('제목을 입력해주세요.'); return; }
  if (_icEditLineups.length < 2) { alert('라인업은 2개 이상 있어야 합니다.'); return; }
  const btn = document.getElementById('ic-edit-submit-btn');
  btn.disabled = true;
  try {
    const lineups = [];
    for (let i=0; i<_icEditLineups.length; i++) {
      const l = _icEditLineups[i];
      let imageUrl = l.imageUrl || '';
      if (l.file) {
        btn.textContent = `업로드 중... (${i+1}/${_icEditLineups.length})`;
        const storageRef = ref(storage, `idealcups/${_icEditCupId}/${l.id}_${Date.now()}`);
        await uploadBytes(storageRef, l.file);
        imageUrl = await getDownloadURL(storageRef);
      }
      lineups.push({ id:l.id, name:l.name, desc:l.desc||'', imageUrl, youtubeUrl:l.youtubeUrl||'', wins:l.wins||0, matches:l.matches||0, championCount:l.championCount||0 });
    }
    await updateDoc(doc(db,'idealCups',_icEditCupId), { title, description, lineups });
    _icUnsavedActive = false;
    closeModal();
    loadIdealCups();
  } catch(e) {
    alert('수정 중 오류가 발생했습니다: ' + e.message);
    btn.disabled = false; btn.textContent = '저장';
  }
};

// ── 이상형 월드컵 · 플레이 ───────────────────────────────────────────
function shuffleArray(arr) {
  const a = [...arr];
  for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

function idealCupRoundLabel(matchCount) {
  const map = {1:'결승',2:'4강',4:'8강',8:'16강',16:'32강',32:'64강',64:'128강'};
  return map[matchCount] || `${matchCount*2}강`;
}

// 라인업 수가 2의 거듭수가 아니어도 대진표를 짤 수 있도록 부전승을 자동 배정
function buildBracketRound0(entries, size) {
  const byesCount = size - entries.length;
  const realRealCount = entries.length - size/2;
  const shuffled = shuffleArray(entries);
  const matches = [];
  let idx = 0;
  for (let i=0;i<realRealCount;i++) { matches.push({a:shuffled[idx], b:shuffled[idx+1], bye:false}); idx+=2; }
  for (let i=0;i<byesCount;i++) { matches.push({a:shuffled[idx], b:null, bye:true}); idx+=1; }
  return shuffleArray(matches);
}

let _icPlay = null;

window.openIdealCupPlay = function(cupId) {
  const cup = idealCups.find(c=>c.id===cupId);
  if (!cup) return;
  const total = (cup.lineups||[]).length;
  if (total < 2) { alert('라인업이 부족합니다.'); return; }
  let sizes = []; let p = 2;
  while (p < total) { sizes.push(p); p *= 2; }
  const maxEven = total % 2 === 0 ? total : total - 1;
  if (maxEven > (sizes[sizes.length-1] || 0)) sizes.push(maxEven);
  openModal(`<div class="modal-title">🏆 ${esc(cup.title)} 시작하기</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:10px">몇 강으로 진행할까요? (등록된 라인업 ${total}개)</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${sizes.map(s=>`<button class="btn" onclick="startIdealCupBracket('${cupId}',${s})">${s===2?'결승(2강)':`${s}강`}</button>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px">${total}개 라인업이 선택한 강수에 정확히 맞지 않으면, 일부는 부전승으로 자동 진출합니다.</div>
    <div class="flex" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">취소</button></div>`);
};

window.startIdealCupBracket = function(cupId, size) {
  const cup = idealCups.find(c=>c.id===cupId);
  if (!cup) return;
  const total = cup.lineups.length;
  const entries = size < total ? shuffleArray(cup.lineups).slice(0, size) : [...cup.lineups];
  const matches0 = buildBracketRound0(entries, size);
  _icPlay = { cupId, cupTitle: cup.title, roundMatches: matches0, matchIdx: 0, roundWinners: [], history: [], finalWinner: null };
  _icUnsavedActive = true;
  renderIdealCupPlayMatch();
};

function renderIdealCupPlayMatch() {
  const p = _icPlay;
  if (!p) return;
  const match = p.roundMatches[p.matchIdx];
  if (!match) return;
  if (match.bye) { advanceIdealCupLocal(match.a, null, true); return; }
  const roundLabel = idealCupRoundLabel(p.roundMatches.length);
  openModal(`<div class="modal-title">🏆 ${esc(p.cupTitle)} · ${roundLabel}</div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px">${p.matchIdx+1}/${p.roundMatches.length}경기</div>
    <div class="ic-vs-wrap" id="ic-vs-wrap">
      <div class="ic-vs-side" id="ic-side-a">
        ${renderIdealCupMedia(match.a)}
        <div style="font-size:14px;font-weight:600;text-align:center">${esc(match.a.name)}</div>
        ${match.a.desc?`<div style="font-size:11px;color:var(--text2);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(match.a.desc)}</div>`:''}
        <button class="btn btn-primary" id="ic-btn-a" style="width:100%" onclick="chooseIdealCupWinner('a')">선택</button>
      </div>
      <div class="ic-vs-mid" id="ic-vs-mid">VS</div>
      <div class="ic-vs-side" id="ic-side-b">
        ${renderIdealCupMedia(match.b)}
        <div style="font-size:14px;font-weight:600;text-align:center">${esc(match.b.name)}</div>
        ${match.b.desc?`<div style="font-size:11px;color:var(--text2);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(match.b.desc)}</div>`:''}
        <button class="btn btn-primary" id="ic-btn-b" style="width:100%" onclick="chooseIdealCupWinner('b')">선택</button>
      </div>
    </div>
    <div class="flex" style="justify-content:flex-end"><button class="btn" onclick="closeIdealCupPlay()">그만하기</button></div>`, 'lg');
}

function renderIdealCupMedia(entry) {
  if (entry.youtubeUrl) {
    const vid = getYoutubeId(entry.youtubeUrl);
    return `<div class="ic-media-box" style="width:100%;aspect-ratio:16/9;border-radius:var(--radius);overflow:hidden;background:var(--bg2)"><iframe width="100%" height="100%" src="https://www.youtube.com/embed/${vid}" title="${esc(entry.name)}" style="border:none" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>`;
  }
  return `<div class="ic-media-box" style="width:100%;aspect-ratio:1/1;border-radius:var(--radius);overflow:hidden;background:var(--bg2);display:flex;align-items:center;justify-content:center">${entry.imageUrl?`<img src="${esc(entry.imageUrl)}" style="width:100%;height:100%;object-fit:contain">`:'<i class="ti ti-photo" style="color:var(--text2);font-size:24px"></i>'}</div>`;
}

window.chooseIdealCupWinner = function(key) {
  const p = _icPlay;
  if (!p) return;
  const match = p.roundMatches[p.matchIdx];
  const winner = match[key];
  const loser = match[key==='a'?'b':'a'];
  const winKey = key, loseKey = key==='a'?'b':'a';
  const sideWin = document.getElementById(`ic-side-${winKey}`);
  const sideLose = document.getElementById(`ic-side-${loseKey}`);
  const mid = document.getElementById('ic-vs-mid');
  const btnA = document.getElementById('ic-btn-a');
  const btnB = document.getElementById('ic-btn-b');
  if (btnA) btnA.disabled = true;
  if (btnB) btnB.disabled = true;
  if (!sideWin || !sideLose) { advanceIdealCupLocal(winner, loser, false); return; }
  sideWin.classList.add('ic-win');
  sideLose.classList.add('ic-lose');
  if (mid) mid.classList.add('ic-fade');
  setTimeout(() => {
    if (_icPlay !== p) return; // 그 사이에 그만하기 등으로 상태가 바뀐 경우 무시
    advanceIdealCupLocal(winner, loser, false);
  }, 700);
};

function advanceIdealCupLocal(winner, loser, isBye) {
  const p = _icPlay;
  if (!p) return;
  if (!isBye) p.history.push({ aId: winner.id, bId: loser.id, winnerId: winner.id });
  p.roundWinners.push(winner);
  p.matchIdx++;
  if (p.matchIdx >= p.roundMatches.length) {
    if (p.roundWinners.length === 1) { finishIdealCupPlay(p.roundWinners[0]); return; }
    const winners = p.roundWinners;
    const nextMatches = [];
    if (winners.length % 2 === 1) {
      // 2의 거듭제곱이 아닌 강수 선택 시, 라운드 중간에 인원이 홀수가 될 수 있음 — 한 명을 무작위로 부전승 처리
      const byeIdx = Math.floor(Math.random()*winners.length);
      nextMatches.push({ a: winners[byeIdx], b: null, bye: true });
      const rest = winners.filter((_,idx)=>idx!==byeIdx);
      for (let i=0;i<rest.length;i+=2) nextMatches.push({ a:rest[i], b:rest[i+1], bye:false });
    } else {
      for (let i=0;i<winners.length;i+=2) nextMatches.push({ a:winners[i], b:winners[i+1], bye:false });
    }
    p.roundMatches = nextMatches;
    p.matchIdx = 0;
    p.roundWinners = [];
  }
  renderIdealCupPlayMatch();
}

window.closeIdealCupPlay = function() {
  if (closeModal()) _icPlay = null;
};

function finishIdealCupPlay(winner) {
  const p = _icPlay;
  if (!p) return;
  p.finalWinner = winner;
  openModal(`<div class="modal-title">🏆 최종 우승!</div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:16px">
      <div style="width:280px;max-width:80%">${renderIdealCupMedia(winner)}</div>
      <div style="font-size:17px;font-weight:700">${esc(winner.name)}</div>
      ${winner.desc?`<div style="font-size:12px;color:var(--text2)">${esc(winner.desc)}</div>`:''}
    </div>
    ${currentUser
      ? `<textarea id="ic-result-comment" placeholder="한 줄 코멘트를 남겨보세요 (선택)" style="width:100%;min-height:50px;margin-bottom:14px"></textarea>
         <div class="flex" style="justify-content:flex-end;gap:8px">
           <button class="btn" onclick="discardIdealCupResult()">닫기</button>
           <button class="btn btn-primary" id="ic-result-submit" onclick="submitIdealCupResult('${winner.id}')">결과 저장</button>
         </div>`
      : `<div style="font-size:12px;color:var(--text2);margin-bottom:14px">로그인하면 결과가 랭킹에 반영되고 코멘트를 남길 수 있어요.</div>
         <div class="flex" style="justify-content:flex-end"><button class="btn" onclick="discardIdealCupResult()">닫기</button></div>`}
  `, 'lg');
}

window.discardIdealCupResult = function() {
  _icPlay = null;
  _icUnsavedActive = false;
  closeModal();
};

window.submitIdealCupResult = async function(winnerId) {
  const p = _icPlay;
  if (!p) return;
  if (!currentUser) { requireLogin('결과 저장에는 로그인이 필요합니다.'); return; }
  const comment = document.getElementById('ic-result-comment').value.trim();
  const btn = document.getElementById('ic-result-submit');
  btn.disabled = true; btn.textContent = '저장 중...';
  try {
    const cupRef = doc(db,'idealCups',p.cupId);
    const snap = await getDoc(cupRef);
    if (snap.exists()) {
      const cupData = snap.data();
      const lineups = (cupData.lineups||[]).map(l=>({...l}));
      p.history.forEach(h=>{
        const a = lineups.find(l=>l.id===h.aId); if (a) a.matches = (a.matches||0)+1;
        const b = lineups.find(l=>l.id===h.bId); if (b) b.matches = (b.matches||0)+1;
        const w = lineups.find(l=>l.id===h.winnerId); if (w) w.wins = (w.wins||0)+1;
      });
      const champ = lineups.find(l=>l.id===winnerId);
      if (champ) champ.championCount = (champ.championCount||0)+1;
      await updateDoc(cupRef, { lineups, plays: (cupData.plays||0)+1 });
    }
    if (comment) {
      await addDoc(collection(db,'idealCupComments'), {
        cupId: p.cupId, winnerLineupId: winnerId, winnerName: p.finalWinner?.name||'',
        comment, authorUid: currentUser.uid, authorName: authorDisplayName(), createdAt: serverTimestamp()
      });
    }
    _icPlay = null;
    _icUnsavedActive = false;
    closeModal();
    loadIdealCups();
  } catch(e) {
    alert('결과 저장 중 오류가 발생했습니다: ' + e.message);
    btn.disabled = false; btn.textContent = '결과 저장';
  }
};

window.openIdealCupRanking = async function(cupId) {
  openModal(`<div class="modal-title">📊 랭킹</div><div style="font-size:13px;color:var(--text2)">불러오는 중...</div>`);
  let cup;
  try {
    const snap = await getDoc(doc(db,'idealCups',cupId));
    if (!snap.exists()) { closeModal(); return; }
    cup = { id:snap.id, ...snap.data() };
  } catch(e) { closeModal(); alert('랭킹을 불러오지 못했습니다: ' + e.message); return; }
  const lineups = [...(cup.lineups||[])].sort((a,b)=>
    (b.championCount||0)-(a.championCount||0) || ((b.matches?(b.wins||0)/b.matches:0) - (a.matches?(a.wins||0)/a.matches:0)));
  openModal(`<div class="modal-title">📊 ${esc(cup.title)} · 랭킹</div>
    <div style="max-height:50vh;overflow-y:auto;margin-bottom:10px">
    ${lineups.length===0 ? `<div style="font-size:13px;color:var(--text2)">아직 플레이 기록이 없습니다.</div>` :
    lineups.map((l,i)=>{
      const rate = l.matches ? Math.round((l.wins||0)/l.matches*100) : 0;
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:0.5px solid var(--border)">
        <div style="width:22px;text-align:center;font-weight:700;color:var(--text2)">${i+1}</div>
        <div style="width:36px;height:36px;border-radius:6px;overflow:hidden;background:var(--bg2);flex-shrink:0;display:flex;align-items:center;justify-content:center">${l.imageUrl?`<img src="${esc(l.imageUrl)}" style="width:100%;height:100%;object-fit:cover">`:l.youtubeUrl?'<i class="ti ti-brand-youtube" style="color:var(--text2);font-size:14px"></i>':'<i class="ti ti-photo-off" style="color:var(--text2);font-size:14px"></i>'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.name)}</div>
          <div style="font-size:11px;color:var(--text2)">우승 ${l.championCount||0}회 · 매치 승률 ${rate}% (${l.wins||0}/${l.matches||0})</div>
        </div>
      </div>`;
    }).join('')}
    </div>
    <div class="flex" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">닫기</button></div>`);
};

window.openIdealCupComments = async function(cupId) {
  openModal(`<div class="modal-title">💬 댓글</div><div style="font-size:13px;color:var(--text2)">불러오는 중...</div>`);
  let comments = [];
  try {
    const snap = await getDocs(collection(db,'idealCupComments'));
    comments = snap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(c=>c.cupId===cupId)
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  } catch(e) {}
  const cup = idealCups.find(c=>c.id===cupId);
  openModal(`<div class="modal-title">💬 ${cup?esc(cup.title):''} · 댓글</div>
    <div style="max-height:50vh;overflow-y:auto;margin-bottom:10px">
    ${comments.length===0 ? `<div style="font-size:13px;color:var(--text2)">아직 댓글이 없습니다.</div>` :
    comments.map(c=>{
      const date = c.createdAt ? new Date(c.createdAt.seconds*1000) : null;
      return `<div style="padding:8px 4px;border-bottom:0.5px solid var(--border)">
        <div style="font-size:12px;color:var(--text2);margin-bottom:2px">🏆 ${esc(c.winnerName||'-')}</div>
        <div style="font-size:13px;margin-bottom:4px;white-space:pre-line">${esc(c.comment)}</div>
        <div style="font-size:11px;color:var(--text2)">${esc(resolveAuthorName(c.authorUid, c.authorName))}${date?' · '+formatDate(date):''}</div>
      </div>`;
    }).join('')}
    </div>
    <div class="flex" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">닫기</button></div>`);
};

let rollingMessages = [];
async function loadRollingMessages(memberId) {
  try {
    const snap = await getDocs(collection(db, 'rollingMessages'));
    rollingMessages = snap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(r=>r.toMemberId===memberId)
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  } catch(e) { rollingMessages = []; }
  renderRollingPaperList(memberId);
}

function renderRollingPaperList(memberId) {
  const el = document.getElementById('rolling-paper-list');
  if (!el) return;
  if (rollingMessages.length===0) { el.innerHTML='<div style="font-size:13px;color:var(--text2)">아직 남겨진 메시지가 없습니다. 첫 메시지를 남겨보세요!</div>'; return; }
  el.innerHTML = rollingMessages.map(r=>`<div style="background:var(--bg2);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px">
    <div style="font-size:13px;line-height:1.6;white-space:pre-line;overflow-wrap:anywhere">${esc(r.message)}</div>
    <div class="flex-between" style="margin-top:6px">
      <div style="font-size:11px;color:var(--text2)">- ${r.anonymous?'익명':esc(resolveAuthorName(r.fromUid, r.fromName))}</div>
      ${(isAdmin||(currentUser&&r.fromUid===currentUser.uid))?`<button class="btn btn-sm btn-danger" onclick="deleteRollingMessage('${r.id}','${memberId}')"><i class="ti ti-trash" style="font-size:11px"></i></button>`:''}
    </div>
  </div>`).join('');
}

window.openAddRollingMessage = function(memberId) {
  if (!currentUser) { requireLogin('롤링페이퍼 메시지를 남기려면 로그인이 필요합니다.'); return; }
  openModal(`<div class="modal-title">💌 롤링페이퍼 메시지 남기기</div>
    <textarea id="rp-message" rows="4" placeholder="따뜻한 한마디를 남겨주세요" style="width:100%;margin-bottom:10px"></textarea>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:14px"><input type="checkbox" id="rp-anon"> 익명으로 남기기</label>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button>
    <button class="btn btn-primary" onclick="submitRollingMessage('${memberId}')">남기기</button></div>`);
};

window.submitRollingMessage = async function(memberId) {
  const message = document.getElementById('rp-message').value.trim();
  if (!message) { alert('메시지를 입력해주세요.'); return; }
  const anonymous = document.getElementById('rp-anon').checked;
  await addDoc(collection(db,'rollingMessages'), {
    toMemberId: memberId, message, anonymous,
    fromUid: currentUser.uid, fromName: authorDisplayName(),
    createdAt: serverTimestamp()
  });
  closeModal();
  toast('메시지를 남겼어요 💌');
  loadRollingMessages(memberId);
};

window.deleteRollingMessage = async function(id, memberId) {
  if (!confirm('이 메시지를 삭제할까요?')) return;
  await deleteDoc(doc(db,'rollingMessages',id));
  loadRollingMessages(memberId);
};

const UPDATES=[
  {version:'v4.18.0',date:'2026.10.04',items:['화면 효과 추가 — 탭을 옮길 때 내용이 부드럽게 떠오르고, 팝업이 열리고 닫힐 때 자연스럽게 나타났다 사라지도록 변경','저장·삭제·복사 등을 하면 화면 아래에 잠깐 결과 알림(토스트)이 떴다 사라짐','앱을 처음 열 때 빈 화면 대신 🎤 로딩 화면 표시, 다크 모드도 첫 화면부터 바로 적용','오늘 있는 벙은 대시보드에 "오늘 · D-DAY"로 강조, 벙 목록에는 "오늘" 배지가 은은하게 깜빡임','참석자 태그가 추가될 때 톡 튀어나오는 효과, 통계·명예의 전당 막대그래프가 차오르는 효과, 카드에 마우스를 올리면 살짝 떠오르는 효과','다크/라이트 모드 전환 시 색이 부드럽게 바뀜, 버튼을 누르면 살짝 눌리는 느낌 추가, 저장 중인 버튼에는 로딩 표시','기기에서 "동작 줄이기"를 켜둔 경우에는 애니메이션이 자동으로 꺼짐']},
  {version:'v4.17.0',date:'2026.10.04',items:['유령 현황 기준 통일 — 기산일이 지난 뒤 정리를 마치기 전까지는 대시보드·회원 명단·유령 정리 탭이 모두 "이번 정리" 기준으로 표시되고, 초기화(또는 "이미 정리했어요")를 누르면 "다음 정리" 기준 미리보기로 바뀜 (예전에는 기산일 다음 날부터 지난주에 온 회원까지 전부 유령 대상으로 보였음). 정리 완료 상태는 서버에 저장되어 다른 운영진 화면에도 반영 (저장 권한이 없으면 완료를 누른 기기에만 반영)','운영진에게는 이번 정리가 남아 있으면 대시보드 상단에 "정리하기" 안내 표시, 다음 정리일까지 남은 날짜를 달력 날짜 기준으로 정확히 계산','벙 목록을 월별로 묶어 보여주고 벙 이름·장소·참석자(별명 포함)로 검색 가능, 예정 벙에는 D-day 표시','벙 추가·수정 시 예전에 입력했던 장소·시간·주제를 자동완성으로 추천, 벙 이름을 비워두면 "10월 4일 번개"처럼 자동으로 지어짐','캘린더에서 날짜를 누르면 그날 벙을 바로 추가(운영진), "오늘" 버튼으로 이번 달로 바로 이동, 벙 상세에서 바로 수정 가능','회원 명단에서 이름을 누르면 그 회원 프로필로 이동, 회원 수 표시, 검색은 이름·별명 모두에서 대소문자 무시','지금 보던 탭이 주소 끝(#members 등)에 기억되어 새로고침해도 그대로 유지되고, 휴대폰 뒤로가기로 이전 탭으로 돌아가거나 열린 팝업만 닫을 수 있음. Esc 키로도 팝업 닫기','갤러리 사진 크게 보기에서 좌우 버튼·키보드 화살표·스와이프로 사진 넘기기','공지사항 빨간 점은 마지막으로 확인한 뒤 새 공지가 올라왔을 때만 표시','통계 탭의 "최근 2개월"을 오늘 기준 최근 두 달로 변경 (기산일 직후에는 기간이 며칠뿐이라 통계가 거의 비어 보이던 문제)','백업 파일에 게시글·플레이리스트·시즌 업적·정산 내역까지 함께 저장','휴대폰에서 입력칸을 누를 때 화면이 확대되던 문제 방지, 금액 입력칸은 숫자 키패드로 열림','카카오톡 인앱 브라우저처럼 복사 기능이 막힌 환경에서도 공지·정산·회고·퇴출 메시지 복사가 되도록 보완','오늘의 노래 추천에 유튜브 링크가 있으면 바로 듣기 링크 표시, 연결이 끊기면 상단 상태줄에 오류 표시']},
  {version:'v4.16.1',date:'2026.10.04',items:['[버그 수정] 정산에서 "벙 선택"으로 시작했다가 "직접 입력"으로 바꾸면, 아무도 체크하지 않았는데 이전 벙 참석자 인원수로 나눠 계산되고 정산 텍스트에 회원 ID가 찍히던 문제 수정 — 모드나 벙을 바꾸면 항목 참여자가 새 참가자 기준으로 다시 맞춰짐','[버그 수정] 정산 직접 입력에서 참가자를 나중에 추가하면 이미 만든 항목에 포함되지 않던 문제 수정 (추가한 사람은 모든 항목에 자동 포함, 빠지는 항목만 체크 해제)','[버그 수정] 정산 저장 후 정산 탭 목록에 바로 안 보이던 문제, 항목명을 비워두면 금액은 계산되는데 저장 내역에서는 빠지던 문제 수정','[버그 수정] 벙 추가·수정 참석자 목록에서 체크박스를 직접 누르면 선택이 안 되고, 이름 글자를 눌러야만 선택되던 문제 수정 (체크박스와 위쪽 태그가 항상 같게 유지)','[버그 수정] 일반 회원·게스트에게도 화면이 다시 그려지면 벙·회원 수정/삭제 버튼이 보이던 문제 수정','[버그 수정] 한국 시간 오전 9시 전에 벙·회원을 추가하면 기본 날짜가 어제로 들어가던 문제, 오늘 있는 벙이 오전 9시 이후 "완료"로 바뀌고 대시보드에서 사라지던 문제 수정','[버그 수정] 회원 명단 정렬(가입일순/이름순/참여율순)을 바꿔도 아무 변화가 없던 문제 수정','[버그 수정] 회원 프로필 검색에서 프로필 사진이 있는 회원은 검색되지 않던 문제 수정','[버그 수정] 한글 입력 중 엔터를 누르면 마지막 글자가 입력칸에 남거나 댓글이 두 번 등록될 수 있던 문제 수정','[버그 수정] 저장 버튼을 빠르게 두 번 누르면 벙·회원·글이 두 개씩 저장되던 문제 수정 (처리 중에는 버튼 잠금)','[버그 수정] 노래 토너먼트 투표창을 바깥 클릭으로 닫으면 투표가 바뀔 때마다 창이 다시 뜨던 문제 수정','[버그 수정] 12월 말에 1월 초 가입 기념일이 보이지 않던 문제 수정, 참석자에서 빠져 최근 참여일이 앞당겨질 때 "유령에서 부활" 업적이 잘못 달리던 문제 수정','[보안] 게시글 제목·닉네임·메모 등에 HTML/스크립트를 넣으면 다른 사람 화면에서 실행될 수 있던 문제 수정 — 사용자가 입력한 글은 모두 글자 그대로 표시']},
  {version:'v4.16.0',date:'2026.10.04',items:['벙 추가 시 구분 기본값을 "번개"로 변경','회원 별명 기능 추가 — 회원 명단에 "별명" 칸이 생기고 회원 추가·수정 화면, 별명 칸의 편집 버튼, "별명 관리"(전체 회원 한 번에 입력)에서 별명을 넣을 수 있음 (예: 고의석 → 의석, uiseok)','벙 참석자·정산 이름 입력 시 대소문자·띄어쓰기를 구분하지 않고(hyeon → Hyeon), 별명으로도 입력 가능(의석 → 고의석). 두 글자 이상이면 일부만 입력해도 한 명으로 특정되면 바로 추가','입력하는 동안 아래 회원 목록이 이름·별명으로 바로 걸러지고, 여러 명이 해당되면 누구인지 고르라고 안내, 없는 이름은 안내 문구 표시','정산 직접 입력에서 이름을 치면 회원 추천이 뜨고, 회원 명단에 없는 이름은 게스트로 구분 표시. 직접 입력 정산에 이름을 붙일 수 있음','별명이 다른 회원 이름·별명과 겹치면 저장 전에 알려줌']},
  {version:'v4.15.0',date:'2026.08.03',items:['유령 정리 탭에 정리 주기 선택 드롭다운 추가 — 기산일이 지나면 이전 두 달 판정 기준을 더 이상 볼 수 없던 문제 수정, 이번 정리 주기가 지난 뒤에도(다음 짝수 달 1일 전까지) 목록 조회·초기화가 계속 가능하며 최근 12회분의 지난 정리 주기와 다음 정리 예정도 조회 가능']},
  {version:'v4.14.0',date:'2026.06.25',items:['이상형월드컵 카드에 "수정" 버튼 추가 — 제작자 본인만 제목/설명/라인업(추가·삭제)을 수정할 수 있음, 기존 라인업의 투표 기록(승수·우승 횟수)은 유지되며 라인업을 삭제하면 해당 기록도 함께 삭제된다는 안내 표시']},
  {version:'v4.13.1',date:'2026.06.25',items:['[버그 수정] 공지사항·게시판·댓글·이상형월드컵 댓글/제작자·롤링페이퍼·사이드바 등 앱 곳곳에 닉네임이 구글 계정 이름으로 표시되던 문제 수정 — 프로필이 연결된 회원은 항상 프로필 닉네임으로 표시되도록 통일','회원이 닉네임을 변경하면 과거에 작성한 글/댓글/롤링페이퍼에 표시되는 이름도 즉시 새 닉네임으로 함께 바뀌도록 변경 (작성 시점에 저장된 이름이 아니라 매번 최신 프로필 이름을 조회해서 표시)','사이드바 좌측 상단 사용자 표시명이 운영진 여부와 무관하게 항상 최신 프로필 닉네임으로 갱신되도록 수정 (기존에는 운영진 권한이 바뀔 때만 갱신되어 계속 구글 이름으로 남아있던 문제)']},
  {version:'v4.13.0',date:'2026.06.25',items:['이상형 월드컵 선택 애니메이션 방식을 변경 — 팝업 자체가 커지며 사진이 잘려 보이던 문제 해결 (영역 크기는 그대로 두고 사진만 확대/축소되는 방식으로 전환), 확대 후 화면을 보여주는 시간과 확대 애니메이션 속도를 살짤 늘림','이상형 월드컵 목록 카드의 썸네일 2장이 고정되지 않고 들어갈 때마다 라인업 중 무작위 2개로 표시되도록 변경','이상형 월드컵 강수 선택 옵션 개선 — 라인업 개수가 2의 거듭제곱이 아닐 때 무리하게 다음 거듭제곱(예: 37명에 64강)으로 건너뛰지 않고, 라인업 수에 맞는 가장 큰 짝수를 최대 옵션으로 제시 (예: 37명 → 4·8·16·32·36강, 41명 → 4·8·16·32·40강). 진행 중 인원이 홀수가 되는 라운드는 자동으로 한 명을 부전승 처리']},
  {version:'v4.12.0',date:'2026.06.25',items:['이상형 월드컵 플레이 화면에 선택 애니메이션 추가 — 후보 선택 시 고른 쪽이 화면을 가득 채우듯 커지고 반대쪽은 사라지는 모션 후 다음 대진으로 자동 전환 (사진/유튜브 영상 매치 모두 동일하게 적용)']},
  {version:'v4.11.2',date:'2026.06.25',items:['[버그 수정] 캘린더 탭에서 벙 이름이 길면 날짜 칸이 억지로 넓어지면서 모바일 화면이 깨지던 문제 수정 — CSS Grid 컬럼을 minmax(0,1fr)로 변경해 내용 길이와 상관없이 칸이 화면 폭에 맞춰 줄어들도록 함 (말줄임 처리는 원래도 있었지만 칸 자체가 늘어나 무용지물이었음)']},
  {version:'v4.11.1',date:'2026.06.25',items:['[버그 수정] 갤러리 사진 삭제(X) 버튼이 호버 시 보이도록 하는 CSS가 없어서 운영진도 버튼을 볼 수 없던 문제 수정 — 항상 표시되도록 변경 (모바일은 호버가 없어 이 방식이 맞음)']},
  {version:'v4.11.0',date:'2026.06.25',items:['반응형 개선 11단계: 회원 프로필 탭 — 프로필 상세의 4칸 통계(참여율/참석벙/연속/벙주)가 좁은 화면에서 너무 빡빡해지던 것을 2칸으로 전환','참석 벙 목록 테이블의 overflow:hidden → 가로 스크롤 방식으로 변경 (프로필 목록 그리드, 월별 차트, 도장판, 궁합카드, 롤링페이퍼는 기존부터 반응형이라 손 안 댐)']},
  {version:'v4.10.0',date:'2026.06.25',items:['반응형 개선 10단계: 놀이터 탭 — 진행 중인 노래 토너먼트 카드의 제목과 투표/다음라운드 버튼이 좁은 화면에서 줄바꿈되도록 수정 (이상형월드컵 카드/투표 화면은 이전 패치에서 이미 대응돼 있어 추가 수정 없음)']},
  {version:'v4.09.0',date:'2026.06.25',items:['반응형 개선 9단계: 명예의 전당 탭 — 연속참석 스트릭/벙주 랭킹 테이블의 overflow:hidden → 가로 스크롤 방식으로 변경해 좁은 화면에서 내용이 잘리지 않게 수정']},
  {version:'v4.08.0',date:'2026.06.25',items:['반응형 개선 8단계: 통계 탭 — 참여율 테이블, 월별 벙현황 테이블의 overflow:hidden → 가로 스크롤 방식으로 변경해 좁은 화면에서 그래프·숫자가 잘리지 않게 수정 (분기별 리포트 카드는 기존부터 반응형이라 손 안 댐)']},
  {version:'v4.07.0',date:'2026.06.25',items:['반응형 개선 7단계: 유령 정리 탭 — 퇴출 대상/연락완료 테이블도 회원 명단과 동일하게 overflow:hidden → 가로 스크롤 방식으로 변경해 좁은 화면에서 내용이 잘리지 않게 수정','상단 기산일 안내 텍스트 + 퇴출메시지/초기화 버튼 줄이 좁은 화면에서 줄바꿈되도록 수정']},
  {version:'v4.06.0',date:'2026.06.25',items:['반응형 개선 6단계: 벙 관리 탭 — 벙 카드의 버튼 줄(공지/회고/정산/수정/삭제, 최대 5개)이 좁은 화면에서 카드 밖으로 넘치지 않고 줄바꿈되도록 수정','벙 제목 영역도 좁아지면 줄어들도록 보강','벙 추가/수정 모달의 참석자 검색 입력칸 보강']},
  {version:'v4.05.0',date:'2026.06.25',items:['반응형 개선 5단계: 회원 명단 탭 — 8개 컬럼짜리 회원 테이블이 좁은 화면에서 내용이 잘려서 안 보이던 문제 수정 (overflow:hidden → 가로 스크롤 가능하게 변경, 테이블은 최소폭 유지해 글자도 안 눌림)','프로필 연결 요청 카드가 좁은 화면에서 줄바꿈되도록 보강']},
  {version:'v4.04.0',date:'2026.06.25',items:['반응형 개선 4단계: 정산 탭 — 정산 계산기의 항목명·금액 입력 줄이 좁은 화면에서 항목명 입력칸을 누르지 않고, 금액·원·삭제 버튼이 자동으로 다음 줄로 내려가도록 변경','참가자 직접입력 칸도 좁은 화면에서 눌리지 않게 보강','정산 목록 카드의 제목/보기·삭제 버튼 영역도 다른 탭과 동일하게 안 밀리도록 수정']},
  {version:'v4.03.0',date:'2026.06.25',items:['반응형 개선 3단계: 게시판 탭 — 자유게시판/건의사항/노래추천 서브탭 버튼 줄이 좁은 화면에서 페이지 전체를 가로로 밀어내지 않도록 그 줄만 가로 스크롤되게 변경','게시글 카드의 제목·수정/삭제 버튼 영역도 공지카드와 동일하게 제목은 줄어들고 버튼은 고정폭 유지되도록 수정']},
  {version:'v4.02.0',date:'2026.06.25',items:['반응형 개선 2단계: 공지사항 탭 — 공지 카드의 제목·태그 영역과 수정/삭제 버튼이 좁은 화면에서 서로 밀리지 않도록 영역 분리 (제목은 줄어들고 버튼은 항상 고정폭 유지)']},
  {version:'v4.01.0',date:'2026.06.25',items:['반응형 전면 개편 시작으로 대버전 4 시작 (앱 전체 탭을 순차적으로 모바일 대응시키는 대규모 작업)','반응형 개선 1단계: 대시보드 탭 — 회원현황/유령현황, 최근 벙/MVP·신규·기념일 카드가 좁은 화면(640px 이하)에서 2단 그리드 대신 1단으로 쌓이도록 변경','모바일 화면에서 본문 좌우 여백, 히어로 카드·통계 카드 내부 여백을 화면 폭에 맞게 축소']},
  {version:'v3.14.0',date:'2026.06.25',items:['버전 표기 체계를 X.YY.Z 방식으로 변경 — X: 구조 개편(Firebase 전환, 놀이터 탭 신설 등) 시점에만 증가 / YY: 기능 업데이트마다 증가, X가 오르면 01부터 다시 시작 / Z: [버그 수정] 항목에서만 증가, YY가 오르면 0으로 초기화','기존 v1.0 ~ v3.14 패치 내역도 새 체계 기준으로 전체 재정리 (날짜·내용은 그대로, 버전 번호만 변경)']},
  {version:'v3.13.2',date:'2026.06.24',items:['[버그 수정] 이상형월드컵 카드의 버튼(시작/랭킹/댓글/삭제)이 폭이 좁을 때 삭제 아이콘만 다음 줄로 내려가던 문제 수정 — 카드 최소 폭을 220px → 270px로 늘려 버튼 4개가 한 줄에 여유있게 들어가도록 조정']},
  {version:'v3.13.1',date:'2026.06.24',items:['[버그 수정] 노래 토너먼트 투표 화면에서 "들어보기"를 여러 곡 연속으로 누르면 모든 곡이 동시에 재생되던 문제 수정 — 새 곡을 재생하면 이전에 재생 중이던 곡은 자동으로 정지']},
  {version:'v3.13.0',date:'2026.06.24',items:['놀이터 탭 진입 시 "이상형 월드컵"이 먼저 보이도록 하위 탭 순서 변경']},
  {version:'v3.12.0',date:'2026.06.24',items:['이상형 월드컵 목록 카드의 썸네일 영역을 더 크게 키우고, 사진이 잘리지 않고 전체가 보이도록 수정','"시작하기" 버튼 텍스트가 줄바꿈되던 문제 수정 ("시작"으로 축약, 줄바꿈 방지 처리)']},
  {version:'v3.11.0',date:'2026.06.24',items:['이상형 월드컵 플레이/최종 결과 화면의 팝업 크기를 크게 확대','사진이 정사각형이 아니어도 잘리지 않고 전체가 보이도록 수정 (빈 공간은 배경색으로 채움)']},
  {version:'v3.10.0',date:'2026.06.24',items:['이상형 월드컵 라인업 등록 화면에서 "설명" 입력칸 제거 — 이름에 바로 설명을 적는 방식으로 통일 (예: "김치찌개를 끓이는 티라노사우르스")','라인업 등록 시 사진 첨부 / 이미지 링크 / 유튜브 링크 중 하나는 다시 필수로 변경 (직전 업데이트에서 선택사항으로 바꿨던 것을 되돌림)']},
  {version:'v3.9.0',date:'2026.06.24',items:['이상형 월드컵 라인업 등록 시 사진/링크 없이 이름만으로도 등록 가능 (예: "김치찌개를 끓이는 티라노사우르스" 처럼 이름에 직접 설명을 적는 방식)','사진·영상이 없는 라인업은 목록·랭킹·플레이 화면에서 빈 이미지 아이콘으로 표시']},
  {version:'v3.8.0',date:'2026.06.24',items:['이상형 월드컵 라인업 등록 시 "이미지 링크(URL)" 직접 입력 옵션 추가 — 사진 첨부 / 이미지 링크 / 유튜브 링크 중 하나 선택 가능']},
  {version:'v3.7.0',date:'2026.06.24',items:['이상형 월드컵 제작 중 / 플레이 중에는 바탕 클릭이나 "취소"·"그만하기" 버튼을 눌러도 한 번 더 확인하도록 변경 — 실수로 화면이 꺼져서 작업 내용이 날아가는 것을 방지']},
  {version:'v3.6.0',date:'2026.06.24',items:['이상형 월드컵 목록 화면에 "임시저장 확인" 버튼 추가 — 제목/설명/라인업 개수와 썸네일을 미리 보고 "이어서 작성" 또는 "삭제" 선택 가능']},
  {version:'v3.5.0',date:'2026.06.24',items:['이상형 월드컵 카드에 "댓글" 버튼 추가 — 플레이 후 남겨진 우승 코멘트를 모아서 최신순으로 확인 가능','이상형 월드컵 제작 중 "임시저장" 기능 추가 — 계정별로 1개씩 저장되며, 다음에 "월드컵 만들기"를 눌렀을 때 이어서 작성할지 선택할 수 있음 (사진도 임시저장 시점에 미리 업로드되어 유지됨)','월드컵 만들기 완료 시 임시저장본은 자동으로 삭제됨']},
  {version:'v3.4.0',date:'2026.06.24',items:['이상형 월드컵 플레이 기능 추가 — 강수 선택 후 랜덤 대진표 생성, 1대1로 클릭하며 진출하는 방식','라인업 개수가 선택한 강수에 딱 맞지 않으면 부전승을 자동 배정해 대진표를 맞춤','사진 라인업과 유튜브 영상 라인업 모두 동일하게 "선택" 버튼으로 통일 (영상은 큰 화면으로 그 자리에서 바로 재생)','최종 우승 결정 시 우승자를 사진과 함께 보여주고, 로그인 회원은 한줄 코멘트 작성 가능','랭킹 화면 추가 — 라인업별 최종 우승 횟수와 매치 승률을 함께 표시']},
  {version:'v3.3.0',date:'2026.06.24',items:['놀이터 탭에 하위 탭 구조 추가 — "노래 토너먼트"(기존 이상형월드컵, 명칭 변경)와 "이상형 월드컵"(신규) 분리','이상형 월드컵 신설 — 회원 누구나 주제/설명/라인업(사진 또는 유튜브 링크)을 등록해 직접 만들 수 있음, 라인업 개수 제한 없음','이상형 월드컵 목록에 인기순/최신순 정렬 및 카드형 리스트(썸네일/제목/설명/참가 인원수) 추가, 삭제는 제작자 본인 또는 운영진만 가능','(플레이/랭킹 기능은 다음 업데이트에서 제공)']},
  {version:'v3.2.0',date:'2026.06.23',items:['노래 추천 게시판·플레이리스트에 유튜브 링크 입력 추가, "유튜브에서 찾기" 버튼으로 검색 결과 새 탭 바로 열기','유튜브 링크 없는 곡은 이상형월드컵 후보 목록에서 자동 제외, 입력 화면에 안내 문구 표시','이상형월드컵 투표 화면에서 "들어보기" 버튼으로 곡을 그 자리에서 바로 재생 가능']},
  {version:'v3.1.1',date:'2026.06.23',items:['[버그 수정] 노래 이상형월드컵 "시작" 버튼이 반응 없던 문제 수정 — Firestore가 지원하지 않는 중첩 배열 구조가 원인, 데이터 구조 변경 및 오류 발생 시 알림 표시 추가']},
  {version:'v3.1.0',date:'2026.06.23',items:['"놀이터" 탭 신설 — 노래 이상형월드컵을 명예의 전당에서 분리해 독립 탭으로 이동','"리포트" 탭을 "통계" 탭에 통합 (월별/분기별 리포트는 통계 화면 하단에서 확인)']},
  {version:'v2.9.0',date:'2026.06.23',items:['노래 이상형월드컵 추가 — 명예의 전당 탭에서 운영진이 추천곡으로 토너먼트 개설, 회원 투표로 라운드 진행, 우승곡은 역대 우승곡 명단에 영구 기록','롤링페이퍼 추가 — 회원 프로필에서 서로에게 메시지 남기기 (익명 가능), 본인/운영진만 삭제 가능']},
  {version:'v2.8.0',date:'2026.06.23',items:['프로필에 "출석 도장판" 추가 — 전체 벙을 도장 형태로 표시, 참석/불참 한눈에 확인','프로필에 "같이 가장 많이 만난 멤버" TOP3 카드 추가','벙 카드에 "회고" 버튼 추가 — 참석 인원, 첫 참석자, 오랜만에 복귀한 멤버, 단골 멤버 등을 자동 정리해 카카오톡 공유용 텍스트로 생성']},
  {version:'v2.7.1',date:'2026.06.23',items:['[버그 수정] 정산 계산기에서 금액 입력 시 한 글자만 쳐도 커서가 사라지던 문제 수정']},
  {version:'v2.7.0',date:'2026.06.18',items:['모임비 정산 계산기 추가 — 사이드바 "정산" 탭, 항목별 금액·참가인원 입력 시 자동 분담 계산','벙 선택 모드(참석자 자동 연동) / 직접 입력 모드 둘 다 지원, 벙 카드에서도 바로 정산 진입 가능','정산 내역은 정산 탭에 저장되어 나중에 다시 확인 가능, 오픈채팅 송금용 복사 텍스트 자동 생성']},
  {version:'v2.6.0',date:'2026.06.18',items:['게시판(자유게시판/건의사항) 글쓰기·수정 시 사진 최대 4장 첨부 가능','사진은 본문 원하는 위치에 삽입 가능 (커서 위치에 [이미지] 표시 자동 삽입, 자유롭게 이동 가능)']},
  {version:'v2.5.0',date:'2026.06.18',items:['가로 스크롤 버그 근본 원인 수정 (레이아웃 구조 문제) + 긴 글은 일정 글자 수 이후 "더보기"로 처리','공지사항 작성자명도 연동된 프로필 이름을 우선 사용하도록 수정']},
  {version:'v2.4.0',date:'2026.06.18',items:['회원에게 운영진/모임장 역할 부여 기능 추가 (회원 명단에서 지정, 동일 관리 권한)','오늘의 노래 추천 — 대시보드에 매일 자동 추천 (운영진 플레이리스트 + 노래 추천 게시판 추천곡 합산)','노래 추천 게시판 추가 — 곡명/아티스트/추천 이유 입력','게시판·공지·댓글에 긴 글(줄바꿈 없는 텍스트) 작성 시 페이지가 가로로 길게 늘어나던 버그 수정']},
  {version:'v2.3.0',date:'2026.06.18',items:['모바일/사파리 로그인 오류 수정 (팝업 우선 방식 + 실패 시 원인 표시)','로그인 없이 둘러보기(게스트 모드) 추가','구글 로그인 시 개인정보 수집·이용 안내 동의 절차 추가','회원 프로필 "목록으로" 버튼 작동 오류 수정','프로필 사진이 전체 회원 목록·이달의 MVP·이달의 벙주 카드에도 반영되도록 수정','운영진 계정도 회원 프로필 연동 가능하도록 수정 (즉시 연결), 회원 명단 탭에 "내 프로필 연결" 버튼 추가']},
  {version:'v2.2.0',date:'2026.06.18',items:['게시판 기능 추가 — 자유게시판, 건의사항(익명 가능), 댓글 기능','회원 프로필 ↔ 구글 계정 연결 시스템 (운영진 승인 방식)','프로필 커스텀 — 닉네임, 사진, 한줄소개, 최애곡/아티스트 (본인만 수정 가능)','통계 탭 기준을 최근 2개월 활동성으로 변경, 명예의 전당(전체 역대)과 역할 구분']},
  {version:'v2.1.0',date:'2026.06.17',items:['Firebase 전환 — 실시간 동기화, 회원별 Google 로그인','공지사항 탭 추가 — 작성/수정/삭제, 상단 고정, 중요 표시','운영진/일반 회원 권한 분리','Firebase Storage로 갤러리 전환']},
  {version:'v1.5.0',date:'2026.06.17',items:['캘린더 탭 추가','회원 프로필 탭 추가']},
  {version:'v1.4.0',date:'2026.06.17',items:['명예의 전당 강화 — 스트릭 랭킹, 벙주 랭킹, 월별 MVP']},
  {version:'v1.3.0',date:'2026.06.17',items:['대시보드 오른쪽 하단 — MVP, 신규 회원, 기념일, 업적 피드']},
  {version:'v1.2.0',date:'2026.06.16',items:['대시보드 리디자인, 업적 시스템, 사이드바 레이아웃']},
  {version:'v1.1.0',date:'2026.06.15',items:['최초 출시']},
];

function renderUpdates() {
  const el=document.getElementById('updates-content');
  if(!el)return;
  el.innerHTML=`<h3 style="margin-bottom:1rem">📋 패치 내역</h3>`+UPDATES.map(u=>`
    <div class="update-item"><div class="update-version">${u.version}</div><div class="update-date">${u.date}</div>
    <div style="font-size:13px;color:var(--text);line-height:1.8">${u.items.map(i=>`• ${i}`).join('<br>')}</div></div>`).join('');
}

// ── 공통 UI ───────────────────────────────────────────────────────
// 탭 이동: 주소 끝(#members 등)에 현재 탭을 남겨서 새로고침해도 그 탭이 유지되고,
// 휴대폰 뒤로가기로 이전 탭으로 돌아갈 수 있게 함.
window.switchTab = function(tab, opts = {}) {
  if (!TABS.includes(tab)) tab = 'dashboard';
  const changed = tab !== currentTab;
  currentTab = tab;
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach((t,i)=>t.classList.toggle('active', TABS[i]===tab));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  const sec = document.getElementById('sec-'+tab);
  if (sec) { void sec.offsetWidth; sec.classList.add('active'); }
  if (!opts.fromHistory && location.hash.slice(1) !== tab) {
    try { history[changed ? 'pushState' : 'replaceState']({tab}, '', '#' + tab); } catch(e) {}
  }
  if (changed) window.scrollTo(0, 0);
  // 모바일 하단 탭바에서 선택한 탭이 화면 밖에 있으면 보이도록 스크롤
  const activeNav = navItems[TABS.indexOf(tab)];
  if (activeNav && window.matchMedia('(max-width:640px)').matches) activeNav.scrollIntoView({inline:'center', block:'nearest', behavior:'smooth'});
  if(tab==='gallery') loadGallery();
  if(tab==='calendar') renderCalendar();
  if(tab==='profile') renderProfileList();
  if(tab==='board') renderBoardList();
  if(tab==='settlement') renderSettlementList();
  if(tab==='playground') renderPlayground();
  if(tab==='notice') { markNoticesSeen(); updateNoticeDot(); }
};

function restoreTabFromHash() {
  const t = decodeURIComponent(location.hash.slice(1));
  if (TABS.includes(t) && t !== currentTab) switchTab(t, {fromHistory: true});
}

window.addEventListener('popstate', () => {
  if (document.getElementById('app').style.display === 'none') return;
  // 팝업이 떠 있을 때 뒤로가기 → 팝업만 닫고 탭은 그대로
  const backdrop = document.getElementById('modal-backdrop');
  const lightbox = document.getElementById('kiku-lightbox');
  if (lightbox || (backdrop.classList.contains('open') && !backdrop.classList.contains('closing'))) {
    try { history.pushState({tab: currentTab}, '', '#' + currentTab); } catch(e) {}
    if (lightbox) closeLightbox(); else closeModal();
    return;
  }
  const t = decodeURIComponent(location.hash.slice(1));
  switchTab(TABS.includes(t) ? t : 'dashboard', {fromHistory: true});
});

let profileSearchQuery = '';
window.filterProfileList = function(q) {
  profileSearchQuery = q;
  const key = normName(q);
  document.querySelectorAll('#profile-list-grid > .profile-grid-card').forEach(card=>{
    card.classList.toggle('is-hidden', !!key && !(card.dataset.search || '').includes(key));
  });
};

window.openProfile = function(id) { selectedMemberId=id; renderMemberProfile(id); window.scrollTo(0, 0); };
window.backToProfileList = function() { selectedMemberId=null; renderProfileList(); };
window.calNav = function(dir) {
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++;}
  if(calMonth<0){calMonth=11;calYear--;}
  renderCalendar();
};
window.calToday = function() { calYear = TODAY.getFullYear(); calMonth = TODAY.getMonth(); renderCalendar(); };

window.showCalBungDetail = function(id) {
  const b=bungs.find(x=>x.id===id);if(!b)return;
  const host=b.hostId?members.find(x=>x.id===b.hostId):null;
  const names=(b.attendees||[]).map(id=>{const m=members.find(x=>x.id===id);return m?m.name:'?'});
  openModal(`<div class="modal-title">${esc(b.name)}</div>
    <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;margin-bottom:16px">
      <div class="flex"><i class="ti ti-calendar" style="color:var(--info)"></i>${formatDate(b.date)}</div>
      ${b.place?`<div class="flex"><i class="ti ti-map-pin" style="color:var(--danger)"></i>${esc(b.place)}</div>`:''}
      ${b.time?`<div class="flex"><i class="ti ti-clock" style="color:var(--success)"></i>${esc(b.time)}</div>`:''}
      ${host?`<div class="flex"><i class="ti ti-crown" style="color:var(--warn)"></i>${esc(host.name)}</div>`:''}
      <div class="flex" style="align-items:flex-start"><i class="ti ti-users" style="color:var(--purple);margin-top:2px"></i><span>${names.map(esc).join(', ')||'없음'} (${names.length}명)</span></div>
      ${b.memo?`<div class="memo-text">📝 ${esc(b.memo)}</div>`:''}
    </div>
    <div class="flex" style="justify-content:flex-end;gap:8px">
      <button class="btn edit-only" onclick="closeModal();openEditBung('${b.id}')"><i class="ti ti-edit"></i> 수정</button>
      <button class="btn btn-primary" onclick="closeModal()">닫기</button>
    </div>`);
};

// ── 모임비 정산 계산기 ───────────────────────────────────────────
let settlementItems = [];
let settlementMode = 'bung';
let settlementBungId = null;
let settlementManualNames = [];
let settlementTitle = '';
let settlementPopName = null; // 방금 추가한 참가자 (태그 등장 효과용)

function settlementParticipants() {
  if (settlementMode === 'bung') {
    const b = bungs.find(x => x.id === settlementBungId);
    if (!b) return [];
    return (b.attendees||[]).map(id => { const m = members.find(x=>x.id===id); return m ? {key:m.id, name:m.name} : null; }).filter(Boolean);
  }
  return settlementManualNames.map(n => ({key:n, name:n}));
}

// 항목별 참여자는 항상 "지금 참가자 목록" 안에서만 유지한다.
// (예전에는 벙 선택 → 직접 입력으로 바꿔도 이전 벙 참석자가 항목에 그대로 남아서,
//  아무도 체크하지 않았는데 그 인원수로 나눠 계산되던 버그가 있었음)
// resetAll: 참가자 목록 자체가 바뀌었을 때(모드/벙 변경) 모든 항목을 "전원 참여"로 초기화
function syncSettlementItems(resetAll) {
  const keys = settlementParticipants().map(p => p.key);
  const valid = new Set(keys);
  settlementItems.forEach(it => {
    it.participants = resetAll ? [...keys] : it.participants.filter(k => valid.has(k));
  });
}
function itemParticipants(it) {
  const valid = new Set(settlementParticipants().map(p => p.key));
  return it.participants.filter(k => valid.has(k));
}
function settlementItemLabel(it, idx) { return (it.name || '').trim() || `항목 ${idx + 1}`; }

// "새 정산" 기본 벙: 오늘 이전에 끝난 벙 중 참석자가 있는 가장 최근 벙
function defaultSettlementBungId() {
  const today = todayStr();
  const sorted = [...bungs].filter(b => b.date).sort((a,b) => b.date.localeCompare(a.date));
  const pick = sorted.find(b => b.date <= today && (b.attendees||[]).length) || sorted.find(b => b.date <= today) || sorted[0];
  return pick ? pick.id : null;
}

window.openSettlement = function(bungId) {
  if (bungId) { switchTab('settlement'); }
  settlementItems = [];
  settlementMode = 'bung';
  settlementBungId = bungId || defaultSettlementBungId();
  settlementManualNames = [];
  settlementTitle = '';
  settlementPopName = null;
  renderSettlementModal();
};

function settlementTagsHTML() {
  if (!settlementManualNames.length) return '<span class="tag-empty">참가자를 입력해주세요</span>';
  return settlementManualNames.map(n => {
    const isMember = members.some(m => m.name === n);
    return `<span class="attendee-tag${isMember ? '' : ' guest'}${n === settlementPopName ? ' pop' : ''}"${isMember ? '' : ' title="회원 명단에 없는 이름 (게스트)"'}>${esc(n)}<span class="tag-x" onclick="removeSettlementManualName(${jsArg(n)})" title="빼기">×</span></span>`;
  }).join('') + `<span class="tag-empty" style="margin-left:2px">${settlementManualNames.length}명</span>`;
}

function settlementSourceHTML() {
  if (settlementMode === 'bung') {
    const list = [...bungs].filter(b => b.date).sort((a,b) => b.date.localeCompare(a.date));
    const ps = settlementParticipants();
    return `<select id="settlement-bung-select" onchange="onSettlementBungChange(this.value)">
        ${list.length===0 ? '<option value="">등록된 벙이 없습니다</option>' : list.map(b => `<option value="${b.id}" ${b.id===settlementBungId?'selected':''}>${formatDate(b.date)} · ${esc(b.name)} (${(b.attendees||[]).length}명)</option>`).join('')}
      </select>
      <div style="font-size:12px;color:var(--text2);margin-top:6px">참석자 ${ps.length}명: ${ps.map(p => esc(p.name)).join(', ') || '없음'}</div>`;
  }
  return `<input type="text" id="settlement-title" placeholder="정산 이름 (선택) — 예: 10월 4일 2차" value="${esc(settlementTitle)}" oninput="onSettlementTitleInput(this.value)" style="margin-bottom:8px">
    <div class="flex" style="gap:8px;margin-bottom:6px">
      <input type="text" id="settlement-name-input" placeholder="이름·별명 입력 후 엔터 (쉼표로 여러 명)" autocomplete="off" style="flex:1;min-width:0" oninput="renderSettlementSuggest()" onkeydown="onEnterKey(event, addSettlementManualName)">
      <button class="btn btn-sm" type="button" style="flex-shrink:0" onclick="addSettlementManualName()">추가</button>
    </div>
    <div class="picker-msg" id="settlement-name-msg"></div>
    <div class="name-suggest" id="settlement-suggest"></div>
    <div class="tag-area" id="settlement-name-tags">${settlementTagsHTML()}</div>
    <div class="settle-hint">회원 이름·별명으로 입력하면 회원 이름으로 들어가요 (대소문자·띄어쓰기 무시). 명단에 없는 이름은 게스트로 추가돼요.<br>추가한 참가자는 모든 항목에 자동 포함되고, 빠지는 항목만 체크를 해제하면 돼요.</div>`;
}

function renderSettlementModal() {
  openModal(`<div class="modal-title"><i class="ti ti-calculator" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>모임비 정산 계산기</div>
    <div class="flex" style="gap:8px;margin-bottom:12px">
      <button class="btn btn-sm ${settlementMode==='bung'?'btn-primary':''}" onclick="setSettlementMode('bung')">벙 선택</button>
      <button class="btn btn-sm ${settlementMode==='manual'?'btn-primary':''}" onclick="setSettlementMode('manual')">직접 입력</button>
    </div>
    <div id="settlement-source-area" style="margin-bottom:14px">${settlementSourceHTML()}</div>
    <div style="font-size:13px;font-weight:500;margin-bottom:8px">정산 항목</div>
    <div id="settlement-items-area" style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px"></div>
    <button class="btn btn-sm" style="margin-bottom:16px" onclick="addSettlementItem()"><i class="ti ti-plus"></i> 항목 추가</button>
    <div id="settlement-result-area"></div>
    <div class="flex" style="justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn" onclick="closeModal()">닫기</button><button class="btn btn-primary" onclick="saveSettlement()"><i class="ti ti-device-floppy"></i> 저장</button></div>`);
  if (settlementItems.length === 0) addSettlementItem();
  else renderSettlementItems();
}

window.onSettlementTitleInput = function(v) { settlementTitle = v; renderSettlementResult(); };

window.setSettlementMode = function(mode) {
  if (mode === settlementMode) return;
  settlementMode = mode;
  settlementPopName = null;
  syncSettlementItems(true);
  renderSettlementModal();
  if (mode === 'manual') document.getElementById('settlement-name-input')?.focus();
};

window.onSettlementBungChange = function(id) {
  settlementBungId = id;
  syncSettlementItems(true);
  renderSettlementModal();
};

// 참가자 목록이 바뀐 뒤 태그·항목·결과만 다시 그림 (입력칸 포커스는 유지)
function refreshSettlementParticipants() {
  const tags = document.getElementById('settlement-name-tags');
  if (tags) tags.innerHTML = settlementTagsHTML();
  renderSettlementItems();
  renderSettlementSuggest();
}

function addSettlementName(name) {
  if (!name || settlementManualNames.includes(name)) return false;
  settlementManualNames.push(name);
  // 새 참가자는 기존 항목 모두에 포함 (항목을 먼저 만들고 사람을 나중에 넣어도 같은 결과)
  settlementItems.forEach(it => { if (!it.participants.includes(name)) it.participants.push(name); });
  settlementPopName = name;
  return true;
}

window.addSettlementManualName = function() {
  const input = document.getElementById('settlement-name-input');
  if (!input) return;
  const tokens = input.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  if (!tokens.length) return;
  const keep = [], notes = [];
  tokens.forEach(t => {
    const r = resolveMemberInput(t);
    if (r.member) {
      if (!addSettlementName(r.member.name)) notes.push(`${r.member.name}님은 이미 들어가 있어요`);
    } else if (r.candidates) {
      keep.push(t);
      notes.push(`"${t}" → ${r.candidates.map(m => m.name).join(', ')} 중 누구인지 골라주세요`);
    } else {
      // 명단에 없는 이름은 게스트로 추가 (외부 인원 정산용)
      if (addSettlementName(t)) notes.push(`"${t}"은(는) 회원 명단에 없어서 게스트로 추가했어요`);
    }
  });
  input.value = keep.join(', ');
  refreshSettlementParticipants();
  const msg = document.getElementById('settlement-name-msg');
  if (msg) msg.textContent = notes.join(' · ');
  input.focus();
};

window.renderSettlementSuggest = function() {
  const input = document.getElementById('settlement-name-input');
  const box = document.getElementById('settlement-suggest');
  if (!input || !box) return;
  const msg = document.getElementById('settlement-name-msg');
  if (msg) msg.textContent = '';
  const token = input.value.split(/[,，]/).pop();
  if (!normName(token)) { box.innerHTML = ''; return; }
  const matches = sortMembersByName(members.filter(m => memberMatchesQuery(m, token) && !settlementManualNames.includes(m.name))).slice(0, 8);
  box.innerHTML = matches.map(m => {
    const al = memberAliases(m);
    return `<button type="button" class="suggest-chip" onclick="pickSettlementName(${jsArg(m.id)})">${esc(m.name)}${al.length ? `<small>${esc(al.join(', '))}</small>` : ''}</button>`;
  }).join('');
};

window.pickSettlementName = function(memberId) {
  const m = members.find(x => x.id === memberId);
  const input = document.getElementById('settlement-name-input');
  if (!m) return;
  if (input) { const parts = input.value.split(/[,，]/); parts.pop(); input.value = parts.map(s => s.trim()).filter(Boolean).join(', '); }
  addSettlementName(m.name);
  refreshSettlementParticipants();
  const msg = document.getElementById('settlement-name-msg');
  if (msg) msg.textContent = '';
  input?.focus();
};

window.removeSettlementManualName = function(name) {
  settlementManualNames = settlementManualNames.filter(n => n !== name);
  settlementItems.forEach(it => { it.participants = it.participants.filter(k => k !== name); });
  settlementPopName = null;
  refreshSettlementParticipants();
};

window.addSettlementItem = function() {
  const participants = settlementParticipants();
  settlementItems.push({ id: 'it'+Date.now()+Math.random().toString(36).slice(2,6), name:'', amount:0, participants: participants.map(p=>p.key) });
  renderSettlementItems();
}

window.removeSettlementItem = function(id) {
  settlementItems = settlementItems.filter(it => it.id !== id);
  renderSettlementItems();
};

function settlementPerText(it) {
  const n = itemParticipants(it).length;
  if (it.amount && n === 0) return '<span style="color:var(--warn)">⚠️ 참여자를 1명 이상 선택해주세요 (지금은 정산에서 빠져요)</span>';
  const per = n > 0 ? Math.round(it.amount / n) : 0;
  return `${n}명 참여 · 1인당 ${per.toLocaleString()}원`;
}

window.updateSettlementItemField = function(id, field, value) {
  const it = settlementItems.find(x => x.id === id);
  if (!it) return;
  it[field] = field === 'amount' ? (parseInt(String(value).replace(/[^0-9]/g,''))||0) : value;
  if (field === 'amount') {
    // 입력칸을 통째로 다시 그리면 커서가 사라지므로, 1인당 금액 표시만 갱신
    const perEl = document.getElementById('settlement-per-'+id);
    if (perEl) perEl.innerHTML = settlementPerText(it);
  }
  renderSettlementResult();
};

window.formatSettlementAmountInput = function(id, el) {
  const it = settlementItems.find(x => x.id === id);
  if (!it) return;
  el.value = it.amount ? it.amount.toLocaleString() : '';
};

window.toggleSettlementParticipant = function(itemId, key) {
  const it = settlementItems.find(x => x.id === itemId);
  if (!it) return;
  if (it.participants.includes(key)) it.participants = it.participants.filter(k => k !== key);
  else it.participants.push(key);
  renderSettlementItems();
};

window.toggleSettlementAll = function(itemId) {
  const it = settlementItems.find(x => x.id === itemId);
  if (!it) return;
  const keys = settlementParticipants().map(p => p.key);
  it.participants = itemParticipants(it).length === keys.length ? [] : [...keys];
  renderSettlementItems();
};

function renderSettlementItems() {
  const area = document.getElementById('settlement-items-area');
  if (!area) return;
  const participants = settlementParticipants();
  area.innerHTML = settlementItems.map(it => {
    const allOn = participants.length > 0 && itemParticipants(it).length === participants.length;
    return `<div style="border:0.5px solid var(--border);border-radius:var(--radius);padding:12px">
      <div class="settle-item-row">
        <input type="text" class="settle-item-name" placeholder="항목명 (예: 노래방)" value="${esc(it.name)}" oninput="updateSettlementItemField('${it.id}','name',this.value)">
        <div class="settle-item-amount-group">
          <input type="text" inputmode="numeric" placeholder="금액" value="${it.amount?it.amount.toLocaleString():''}" style="width:110px;text-align:right" oninput="updateSettlementItemField('${it.id}','amount',this.value)" onblur="formatSettlementAmountInput('${it.id}',this)">
          <span style="font-size:13px;color:var(--text2)">원</span>
          <button class="btn btn-sm btn-danger" onclick="removeSettlementItem('${it.id}')" aria-label="항목 삭제"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${participants.length===0?'<span style="font-size:12px;color:var(--text2)">참가자가 없습니다</span>':participants.map(p=>{
          const checked = it.participants.includes(p.key);
          return `<label style="display:flex;align-items:center;gap:4px;font-size:13px;border:0.5px solid var(--border);border-radius:var(--radius);padding:4px 10px;cursor:pointer;transition:background-color .15s,color .15s;${checked?'background:var(--bg2)':'color:var(--text3)'}"><input type="checkbox" ${checked?'checked':''} style="margin:0" onchange="toggleSettlementParticipant('${it.id}',${jsArg(p.key)})">${esc(p.name)}</label>`;
        }).join('')}
        ${participants.length>1?`<button type="button" class="alias-edit-btn" onclick="toggleSettlementAll('${it.id}')">${allOn?'모두 해제':'모두 선택'}</button>`:''}
      </div>
      <div id="settlement-per-${it.id}" style="font-size:12px;color:var(--text2);margin-top:8px">${settlementPerText(it)}</div>
    </div>`;
  }).join('');
  renderSettlementResult();
}

function computeSettlementTotals() {
  const participants = settlementParticipants();
  const totals = {};
  participants.forEach(p => totals[p.key] = 0);
  let grandTotal = 0;
  settlementItems.forEach(it => {
    const ps = itemParticipants(it);
    if (!it.amount || ps.length === 0) return;
    const per = Math.round(it.amount / ps.length);
    grandTotal += it.amount;
    ps.forEach(key => { totals[key] += per; });
  });
  return { totals, grandTotal, participants };
}

function renderSettlementResult() {
  const area = document.getElementById('settlement-result-area');
  if (!area) return;
  const { totals, grandTotal, participants } = computeSettlementTotals();
  if (participants.length === 0 || settlementItems.every(it=>!it.amount)) { area.innerHTML=''; return; }
  const sumCheck = Object.values(totals).reduce((a,b)=>a+b,0);
  area.innerHTML = `<div style="font-size:13px;font-weight:500;margin-bottom:8px">개인별 정산 결과</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:8px">
      ${participants.map(p=>`<div style="background:var(--bg2);border-radius:var(--radius);padding:10px 12px">
        <div style="font-size:12px;color:var(--text2)">${esc(p.name)}</div>
        <div style="font-size:18px;font-weight:500">${(totals[p.key]||0).toLocaleString()}원</div>
      </div>`).join('')}
    </div>
    <div style="font-size:12px;color:var(--text3)">총 지출 ${grandTotal.toLocaleString()}원 · 분담 합계 ${sumCheck.toLocaleString()}원${sumCheck!==grandTotal?` (1원 단위 반올림 차이 ${Math.abs(sumCheck-grandTotal).toLocaleString()}원)`:''}</div>
    <div style="margin-top:12px">
      <div class="flex-between" style="margin-bottom:6px"><span style="font-size:13px;font-weight:500">오픈채팅 정산 요청 텍스트</span><button class="btn btn-sm" onclick="copySettlementText(this)"><i class="ti ti-copy"></i> 복사</button></div>
      <div class="template-box" id="settlement-text">${esc(buildSettlementText())}</div>
    </div>`;
}

function buildSettlementText() {
  const b = settlementMode === 'bung' ? bungs.find(x=>x.id===settlementBungId) : null;
  const title = b ? `${formatDate(b.date)} ${b.name} 정산 안내` : `${(settlementTitle||'').trim() || '모임비'} 정산 안내`;
  const { totals, participants } = computeSettlementTotals();
  const itemLines = settlementItems.map((it, idx) => ({it, idx, ps: itemParticipants(it)})).filter(x => x.it.amount && x.ps.length > 0).map(({it, idx, ps}) => {
    const names = ps.map(k => participants.find(p=>p.key===k)?.name || k).join(', ');
    const per = Math.round(it.amount / ps.length);
    return `${settlementItemLabel(it, idx)} ${it.amount.toLocaleString()}원 ÷ ${ps.length}명 = ${per.toLocaleString()}원 (${names})`;
  }).join('\n');
  const personLines = participants.map(p => `▸ ${p.name}: ${(totals[p.key]||0).toLocaleString()}원`).join('\n');
  return `${title}\n\n${itemLines}\n\n${personLines}\n\n오픈채팅 송금으로 보내주세요!`;
}

window.copySettlementText = function(btn) {
  copyText(document.getElementById('settlement-text').innerText, btn);
};

window.saveSettlement = async function() {
  const { totals, grandTotal, participants } = computeSettlementTotals();
  const validItems = settlementItems.map((it, idx) => ({it, idx, ps: itemParticipants(it)})).filter(x => x.it.amount && x.ps.length > 0);
  if (validItems.length === 0) { alert('금액과 참여자가 있는 정산 항목을 1개 이상 입력해주세요.'); return; }
  const b = settlementMode === 'bung' ? bungs.find(x => x.id === settlementBungId) : null;
  if (settlementMode === 'bung' && !b) { alert('정산할 벙을 선택해주세요.'); return; }
  const data = {
    mode: settlementMode,
    bungId: b ? b.id : null,
    title: b ? b.name : ((settlementTitle||'').trim() || '직접 입력 정산'),
    date: b ? b.date : todayStr(),
    items: validItems.map(({it, idx, ps}) => ({name: settlementItemLabel(it, idx), amount: it.amount, participants: ps})),
    participants,
    totals,
    grandTotal,
    text: buildSettlementText(),
    createdAt: serverTimestamp()
  };
  const ref = await addDoc(collection(db, 'settlements'), data);
  if (b) await updateDoc(doc(db, 'bungs', b.id), { settlement: { settlementId: ref.id, grandTotal } });
  closeModal();
  toast(`정산을 저장했어요 · 총 ${grandTotal.toLocaleString()}원`);
  if (currentTab === 'settlement') renderSettlementList();
};

function renderSettlementList() {
  const el = document.getElementById('settlement-list');
  if (!el) return;
  getDocs(query(collection(db,'settlements'), orderBy('createdAt','desc'))).then(snap => {
    const items = snap.docs.map(d => ({id:d.id, ...d.data()}));
    if (items.length === 0) { el.innerHTML = '<div class="empty-state"><i class="ti ti-calculator"></i>정산 내역이 없습니다.<br><span style="font-size:12px">벙 카드의 "정산" 버튼이나 위의 "새 정산"으로 시작해보세요.</span></div>'; return; }
    el.innerHTML = items.map(s => `<div class="bung-card">
      <div class="flex-between mb-1">
        <div class="flex" style="min-width:0;flex:1;flex-wrap:wrap"><strong>${esc(s.title)}</strong><span style="font-size:12px;color:var(--text2)">${formatDate(s.date)}</span></div>
        <div class="flex" style="gap:4px;flex-shrink:0">
          <button class="btn btn-sm" onclick="viewSettlement('${s.id}')"><i class="ti ti-eye"></i> 보기</button>
          <button class="btn btn-sm btn-danger edit-only" onclick="deleteSettlement('${s.id}','${s.bungId||''}')"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text2)">총 ${(s.grandTotal||0).toLocaleString()}원 · ${(s.participants||[]).length}명 · ${(s.participants||[]).map(p=>esc(p.name)).join(', ')}</div>
    </div>`).join('');
  }).catch(e => { el.innerHTML = `<div class="empty-state"><i class="ti ti-alert-circle"></i>정산 내역을 불러오지 못했습니다.<br><span style="font-size:12px">${esc(e.message)}</span></div>`; });
}

window.viewSettlement = async function(id) {
  const snap = await getDoc(doc(db,'settlements',id));
  if (!snap.exists()) return;
  const s = snap.data();
  openModal(`<div class="modal-title"><i class="ti ti-receipt-2" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>${esc(s.title)}</div>
    <div class="template-box" style="margin-bottom:16px">${esc(s.text)}</div>
    <div class="flex" style="justify-content:flex-end;gap:8px">
      <button class="btn" onclick="closeModal()">닫기</button>
      <button class="btn btn-primary" onclick="copyViewedSettlement(this)" data-text="${encodeURIComponent(s.text||'')}"><i class="ti ti-copy"></i> 복사</button>
    </div>`);
};

window.copyViewedSettlement = function(btn) {
  copyText(decodeURIComponent(btn.getAttribute('data-text')), btn);
};

window.deleteSettlement = async function(id, bungId) {
  if (!confirm('이 정산 내역을 삭제할까요?')) return;
  await deleteDoc(doc(db,'settlements',id));
  if (bungId && bungs.some(b => b.id === bungId && b.settlement && b.settlement.settlementId === id)) await updateDoc(doc(db,'bungs',bungId), { settlement: null });
  renderSettlementList();
  toast('정산 내역을 삭제했어요', 'info');
};

// 클립보드 복사: 카카오톡 인앱 브라우저처럼 clipboard API가 막힌 환경에서도 동작하도록 예비 방식 사용
function copyText(text, btn) {
  const done = () => {
    if (btn) {
      if (!btn.dataset.orig) btn.dataset.orig = btn.innerHTML;
      btn.innerHTML = '<i class="ti ti-check"></i> 복사됨!';
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(() => { btn.innerHTML = btn.dataset.orig; }, 2000);
    }
    toast('복사했어요. 카카오톡에 붙여넣으세요');
  };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch(e) {}
    ta.remove();
    if (ok) done(); else toast('복사하지 못했어요. 텍스트를 길게 눌러 직접 복사해주세요', 'error');
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}
window.copyText = copyText;

window.openTemplate = function(id) {
  const b=bungs.find(x=>x.id===id);if(!b)return;
  const d=parseDateStr(b.date);
  const weekdays=['일','월','화','수','목','금','토'];
  const dateStr=`${d.getMonth()+1}월 ${d.getDate()}일(${weekdays[d.getDay()]})`;
  const template=`일시 : ${dateStr}\n장소 : ${b.place||'미정'}\n시간 : ${b.time||'미정'}\n인원 : ${(b.attendees||[]).length}명\n주제 : ${b.topic||'노래방'}${b.memo?`\n\n${b.memo}`:''}`;
  openModal(`<div class="modal-title"><i class="ti ti-speakerphone" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>벙 공지 템플릿</div>
    <div class="template-box" id="template-text">${esc(template)}</div>
    <div class="alert alert-info" style="margin-bottom:12px"><i class="ti ti-info-circle"></i>복사 후 카카오톡에 붙여넣으세요.</div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">닫기</button>
    <button class="btn btn-primary" onclick="copyTemplate(this)"><i class="ti ti-copy"></i> 복사</button></div>`);
};

window.copyTemplate = function(btn) {
  copyText(document.getElementById('template-text').innerText, btn);
};

window.openBungRecap = function(id) {
  const b = bungs.find(x=>x.id===id); if(!b) return;
  const allSorted = [...bungs].sort((a,c)=>(a.date||'').localeCompare(c.date||''));
  const idx = allSorted.findIndex(x=>x.id===id);
  const priorBungs = allSorted.slice(0, idx);
  const attendeeIds = b.attendees||[];
  const attendeeMembers = attendeeIds.map(aid=>members.find(x=>x.id===aid)).filter(Boolean);
  const firstTimers = attendeeMembers.filter(m=>!priorBungs.some(pb=>(pb.attendees||[]).includes(m.id)));
  let comeback=null, maxGap=-1;
  attendeeMembers.forEach(m=>{
    if(firstTimers.includes(m)) return;
    let lastIdx=-1;
    priorBungs.forEach((pb,i)=>{ if((pb.attendees||[]).includes(m.id)) lastIdx=i; });
    if(lastIdx===-1) return;
    const gap = priorBungs.length - 1 - lastIdx;
    if(gap>maxGap){ maxGap=gap; comeback={member:m, gap}; }
  });
  const host = b.hostId ? members.find(x=>x.id===b.hostId) : null;
  const totalSoFar = idx+1;
  const veteran = [...attendeeMembers].sort((a,c)=>{
    const ca = allSorted.slice(0,idx+1).filter(x=>(x.attendees||[]).includes(a.id)).length;
    const cc = allSorted.slice(0,idx+1).filter(x=>(x.attendees||[]).includes(c.id)).length;
    return cc-ca;
  })[0];
  const veteranCount = veteran ? allSorted.slice(0,idx+1).filter(x=>(x.attendees||[]).includes(veteran.id)).length : 0;

  const lines = [];
  lines.push(`🎤 ${b.name} 회고`);
  lines.push(`📅 ${formatDate(b.date)}${b.place?' · '+b.place:''}`);
  lines.push(`👥 참석 ${attendeeMembers.length}명: ${attendeeMembers.map(m=>m.name).join(', ')||'없음'}`);
  if(host) lines.push(`👑 벙주: ${host.name}`);
  if(firstTimers.length>0) lines.push(`🌱 첫 참석: ${firstTimers.map(m=>m.name).join(', ')}`);
  if(comeback && comeback.gap>=2) lines.push(`🎉 오랜만에 등장: ${comeback.member.name} (벙 ${comeback.gap}번 쉬고 복귀!)`);
  if(veteran && veteranCount>=3) lines.push(`💎 이 멤버 단골: ${veteran.name} (지금까지 ${veteranCount}번째 참석)`);
  lines.push(`📊 KIKU 통산 ${totalSoFar}번째 벙`);
  const recapText = lines.join('\n');

  openModal(`<div class="modal-title"><i class="ti ti-sparkles" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>벙 회고</div>
    <div class="template-box" id="recap-text" style="white-space:pre-line">${esc(recapText)}</div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">닫기</button>
    <button class="btn btn-primary" onclick="copyRecapText(this)"><i class="ti ti-copy"></i> 복사</button></div>`);
};

window.copyRecapText = function(btn) {
  copyText(document.getElementById('recap-text').innerText, btn);
};

window.openGhostMessage = function() {
  const cd=getGhostCycleDate(resolvedGhostOffset());
  const ghosts=members.filter(m=>getMemberStatus(m,cd)==='ghost');
  if(ghosts.length===0){openModal(`<div class="modal-title">퇴출 메시지</div><div class="alert alert-success"><i class="ti ti-check"></i>퇴출 대상자가 없습니다.</div><div class="flex" style="justify-content:flex-end"><button class="btn btn-primary" onclick="closeModal()">확인</button></div>`);return;}
  const nameList=ghosts.map(m=>`• ${m.name}`).join('\n');
  const msg=`안녕하세요! KIKU 운영진입니다 🎤\n\n${formatDate(cd)} 기준 유령 회원 정리를 진행합니다.\n\n아래 회원분들은 최근 2개월간 벙 참여 기록이 없어 퇴출 예정입니다.\n\n${nameList}\n\n계속 활동을 원하시는 분은 운영진에게 연락 주세요!\n연락 없으실 경우 자동 퇴출 처리됩니다. 🙏`;
  openModal(`<div class="modal-title">퇴출 메시지</div>
    <div class="template-box" id="ghost-msg-text">${esc(msg)}</div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">닫기</button>
    <button class="btn btn-primary" onclick="copyGhostMsg(this)"><i class="ti ti-copy"></i> 복사</button></div>`);
};

window.copyGhostMsg = function(btn) {
  copyText(document.getElementById('ghost-msg-text').innerText, btn);
};

window.confirmReset = function() {
  const cur = getGhostCycleDate(0);
  openModal(`<div class="modal-title" style="color:var(--danger)"><i class="ti ti-alert-triangle" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>초기화 확인</div>
    <div class="alert alert-danger" style="margin-bottom:12px"><div>모든 회원의 <strong>운영진 연락 여부</strong>를 초기화하고, 이번 정리(${formatDate(cur)})를 <strong>완료</strong>로 표시합니다.<br><span style="font-size:12px">퇴출 처리(회원 삭제)를 먼저 마친 뒤에 실행하세요.</span></div></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-danger" onclick="doReset()">초기화 실행</button></div>`);
};

// 이번 정리를 완료로 기록 (이 기기 + 가능하면 Firestore에도 저장해서 다른 운영진 화면에도 반영)
async function saveGhostDoneCycle(cycle) {
  rememberGhostDoneCycle(cycle);
  try {
    await setDoc(doc(db, 'settings', 'ghostCleanup'), {doneCycle: cycle, doneAt: serverTimestamp(), doneBy: currentUser ? authorDisplayName() : ''});
  } catch(e) {
    console.warn('정리 완료 상태를 서버에 저장하지 못했어요 (이 기기에만 기록됨):', e.message);
  }
  ghostSelectedOffset = null;
  renderAll();
}

window.doReset = async function() {
  const cycle = toDateStr(getGhostCycleDate(0));
  const targets = members.filter(m => m.contacted);
  for (const m of targets) await updateDoc(doc(db,'members',m.id),{contacted:false});
  closeModal();
  await saveGhostDoneCycle(cycle);
  toast(`이번 정리(${formatDate(cycle)}) 완료! ${targets.length ? `연락 여부 ${targets.length}명 초기화` : '초기화할 연락 기록은 없었어요'}`);
};

window.markGhostCycleDone = async function() {
  const cycle = toDateStr(getGhostCycleDate(0));
  if (!confirm(`이번 정리(${formatDate(cycle)})를 이미 마치셨나요?\n완료로 표시하면 대시보드·회원 명단이 다음 정리 기준으로 바뀌어요. (회원 데이터는 바뀌지 않아요)`)) return;
  await saveGhostDoneCycle(cycle);
  toast(`이번 정리(${formatDate(cycle)})를 완료로 표시했어요`);
};

// ── 벙 참석자 선택기 동작 ───────────────────────────────────────────
function attendeeTagsHTML(mode, popId) {
  const ids = attendeeOrder[mode].filter(id => members.some(m => m.id === id));
  if (ids.length === 0) return '<span class="tag-empty">아직 선택한 참석자가 없어요</span>';
  return ids.map(id => {
    const m = members.find(x => x.id === id);
    return `<span class="attendee-tag${id === popId ? ' pop' : ''}" data-id="${m.id}">${esc(m.name)}<span class="tag-x" onclick="removeAttendee('${mode}','${m.id}')" title="빼기">×</span></span>`;
  }).join('') + `<span class="tag-empty" style="margin-left:2px">${ids.length}명</span>`;
}

function setAttendee(mode, id, on) {
  const cb = document.querySelector(`#${mode}-attendee-list .attend-check[value="${id}"]`);
  if (cb) cb.checked = on;
  const order = attendeeOrder[mode];
  const idx = order.indexOf(id);
  if (on && idx === -1) order.push(id);
  if (!on && idx !== -1) order.splice(idx, 1);
  const area = document.getElementById(`${mode}-tag-area`);
  if (area) area.innerHTML = attendeeTagsHTML(mode, on ? id : null);
  updateHostSelect(mode);
}

window.onAttendeeCheck = function(mode, cb) { setAttendee(mode, cb.value, cb.checked); };
window.removeAttendee = function(mode, id) { setAttendee(mode, id, false); };

window.handleAttendeeInput = function(e, mode) {
  if ((e.key === ',' || e.key === '，') && !e.isComposing) { e.preventDefault(); handleAttendeeAdd(mode); return; }
  onEnterKey(e, () => handleAttendeeAdd(mode));
};

// 입력 중인 이름(마지막 쉼표 뒤)으로 아래 회원 목록을 바로 걸러서 보여줌 (이름·별명, 대소문자 무시)
window.onAttendeeQuery = function(mode) {
  const input = document.getElementById(mode === 'edit' ? 'member-search-edit' : 'member-search');
  const key = normName((input?.value || '').split(/[,，]/).pop());
  document.querySelectorAll(`#${mode}-attendee-list .attendee-label`).forEach(l => {
    l.classList.toggle('is-hidden', !!key && !(l.dataset.search || '').includes(key));
  });
  const msg = document.getElementById(`${mode}-picker-msg`);
  if (msg) msg.textContent = '';
};

window.handleAttendeeAdd = function(mode) {
  const input = document.getElementById(mode === 'edit' ? 'member-search-edit' : 'member-search');
  if (!input) return;
  const tokens = input.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  if (!tokens.length) return;
  const keep = [], notes = [];
  tokens.forEach(t => {
    const r = resolveMemberInput(t);
    if (r.member) setAttendee(mode, r.member.id, true);
    else if (r.candidates) { keep.push(t); notes.push(`"${t}" → ${r.candidates.map(m => m.name).join(', ')} 중 누구인지 아래 목록에서 골라주세요`); }
    else { keep.push(t); notes.push(`"${t}"에 해당하는 회원이 없어요 (회원 명단에서 별명을 등록해두면 별명으로도 찾을 수 있어요)`); }
  });
  input.value = keep.join(', ');
  onAttendeeQuery(mode);
  const msg = document.getElementById(`${mode}-picker-msg`);
  if (msg) msg.textContent = notes.join(' · ');
  if (keep.length) { input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake'); }
  input.focus();
};

window.updateHostSelect = function(mode){
  const prefix = mode==='add' ? 'b' : 'eb';
  const hostSel = document.getElementById(`${prefix}-host`);
  if (!hostSel) return;
  const currentVal = hostSel.value;
  hostSel.innerHTML = '<option value="">선택 안 함</option>' + attendeeOrder[mode].map(id => {
    const m = members.find(x => x.id === id);
    return m ? `<option value="${m.id}" ${currentVal===m.id?'selected':''}>${esc(m.name)}</option>` : '';
  }).join('');
};

// 운영진 전용 버튼은 body.is-admin 여부로 CSS에서 한 번에 보이기/숨기기 처리
// (예전에는 화면이 다시 그려지면 일반 회원에게도 수정/삭제 버튼이 보였음)
function updateEditMode(){
  document.body.classList.toggle('is-admin', !!isAdmin);
}

// ── 팝업(모달) ──────────────────────────────────────────────────────
let _modalCloseTimer = null;
function openModal(html, size){
  const backdrop = document.getElementById('modal-backdrop');
  const content = document.getElementById('modal-content');
  clearTimeout(_modalCloseTimer);
  backdrop.classList.remove('closing');
  const wasOpen = backdrop.classList.contains('open');
  content.innerHTML = html;
  content.classList.toggle('modal-lg', size === 'lg');
  backdrop.classList.add('open');
  if (!wasOpen) content.scrollTop = 0;
  // 첫 입력칸(autofocus)에 커서. 휴대폰에서는 키보드가 갑자기 올라오지 않도록 마우스 환경에서만.
  const af = content.querySelector('[autofocus]');
  if (af && window.matchMedia('(hover:hover) and (pointer:fine)').matches) setTimeout(() => af.focus(), 30);
}
let _icUnsavedActive = false; // 이상형월드컵 제작/플레이 중 닫기 보호
window.closeModal = function(){
  if (_icUnsavedActive) {
    if (!confirm('작성/진행 중인 내용이 사라집니다. 정말 닫을까요?')) return false;
    _icUnsavedActive = false;
  }
  // 노래 토너먼트 투표창을 바깥 클릭·Esc로 닫아도 실시간 구독이 남아 창이 다시 뜨는 일이 없도록 정리
  if (activeTournamentUnsub) { activeTournamentUnsub(); activeTournamentUnsub = null; activeTournamentData = null; }
  const backdrop = document.getElementById('modal-backdrop');
  if (!backdrop.classList.contains('open')) return true;
  backdrop.classList.add('closing');
  clearTimeout(_modalCloseTimer);
  _modalCloseTimer = setTimeout(() => backdrop.classList.remove('open', 'closing'), 160);
  return true;
};
// 텍스트 드래그 중 마우스가 배경으로 나가서 click이 발생해도 닫히지 않도록,
// mousedown이 배경 자체에서 "시작"된 경우에만 닫히도록 처리 (드래그 시작점이 모달 내부면 무시)
let modalMouseDownOnBackdrop = false;
document.getElementById('modal-backdrop').addEventListener('mousedown',function(e){modalMouseDownOnBackdrop = (e.target===this);});
document.getElementById('modal-backdrop').addEventListener('click',function(e){if(e.target===this && modalMouseDownOnBackdrop)closeModal();modalMouseDownOnBackdrop=false;});

// Esc로 팝업/사진 닫기, 사진 보기에서는 ← → 로 넘기기
document.addEventListener('keydown', e => {
  if (e.isComposing) return;
  const lightbox = document.getElementById('kiku-lightbox');
  if (lightbox) {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') stepLightbox(-1);
    else if (e.key === 'ArrowRight') stepLightbox(1);
    return;
  }
  if (e.key !== 'Escape') return;
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop.classList.contains('open') && !backdrop.classList.contains('closing')) closeModal();
});

window.toggleTheme = function(){
  const root=document.documentElement;
  const next=root.getAttribute('data-theme')==='dark'?'light':'dark';
  root.classList.add('theme-anim');
  root.setAttribute('data-theme',next);
  try { localStorage.setItem('kiku-theme',next); } catch(e) {}
  document.getElementById('theme-icon').className=next==='dark'?'ti ti-sun':'ti ti-moon';
  setTimeout(() => root.classList.remove('theme-anim'), 400);
};

function initTheme(){
  let saved = null;
  try { saved = localStorage.getItem('kiku-theme'); } catch(e) {}
  const prefersDark=window.matchMedia('(prefers-color-scheme:dark)').matches;
  const theme=saved||(prefersDark?'dark':'light');
  document.documentElement.setAttribute('data-theme',theme);
  const icon=document.getElementById('theme-icon');
  if(icon)icon.className=theme==='dark'?'ti ti-sun':'ti ti-moon';
}

// 저장·삭제 버튼 중복 클릭 방지 (처리 중에는 버튼에 로딩 표시)
['addNotice','editNotice','addPost','editPost','addComment','addMember','editMember','saveAliases','saveAliasManager',
 'addBung','editBung','deleteBung','deleteMember','saveSettlement','submitRollingMessage','addPlaylistSong',
 'requestProfileLink','saveMyProfile','saveRole','doReset','markGhostCycleDone'].forEach(guardAction);
