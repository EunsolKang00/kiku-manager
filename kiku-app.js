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
};

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

onAuthStateChanged(auth, async user => {
  try {
    await getRedirectResult(auth);
  } catch(e) {
    const statusEl = document.getElementById('login-status');
    if (statusEl) statusEl.textContent = '로그인 실패: ' + e.message + ' (' + (e.code||'') + ')';
  }
  if (user) {
    currentUser = user;
    isAdmin = ADMIN_EMAILS.includes(user.email);
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    resetAuthActionBtn();
    document.getElementById('sidebar-user').innerHTML = `<i class="ti ti-user" style="font-size:12px"></i>${user.displayName||user.email}${isAdmin?'<span style="font-size:10px;background:var(--warn-bg);color:var(--warn);padding:1px 5px;border-radius:3px;margin-left:4px">운영진</span>':''}`;
    updateEditMode();
    initTheme();
    await loadData();
    setTimeout(checkProfileLink, 600);
  } else {
    currentUser = null;
    isAdmin = false;
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  }
});

function refreshAdminStatus() {
  if (!currentUser) return;
  const wasAdmin = isAdmin;
  const me = members.find(m => m.linkedUid === currentUser.uid);
  isAdmin = ADMIN_EMAILS.includes(currentUser.email) || (me && (me.role === 'admin' || me.role === 'host'));
  if (isAdmin !== wasAdmin) {
    updateEditMode();
    const sidebarUser = document.getElementById('sidebar-user');
    if (sidebarUser) {
      sidebarUser.innerHTML = `<i class="ti ti-user" style="font-size:12px"></i>${currentUser.displayName||currentUser.email}${isAdmin?'<span style="font-size:10px;background:var(--warn-bg);color:var(--warn);padding:1px 5px;border-radius:3px;margin-left:4px">운영진</span>':''}`;
    }
  }
}

async function loadData() {
  setSyncStatus('loading', '데이터 불러오는 중...');
  try {
    const memberUnsub = onSnapshot(collection(db, 'members'), snap => {
      members = snap.docs.map(d => ({id: d.id, ...d.data()}));
      nextMemberId = members.length > 0 ? Math.max(...members.map(m => parseInt(m.numId)||0)) + 1 : 1;
      refreshAdminStatus();
      renderAll();
      checkAndFinalizeSeasonAwards();
    });
    const bungUnsub = onSnapshot(query(collection(db, 'bungs'), orderBy('date', 'desc')), snap => {
      bungs = snap.docs.map(d => ({id: d.id, ...d.data()}));
      nextBungId = bungs.length > 0 ? Math.max(...bungs.map(b => parseInt(b.numId)||0)) + 1 : 1;
      renderAll();
    });
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
    unsubscribers = [memberUnsub, bungUnsub, noticeUnsub, postUnsub, playlistUnsub, seasonAwardUnsub];
    setSyncStatus('connected', '실시간 동기화 중');
  } catch(e) {
    setSyncStatus('disconnected', '연결 실패: ' + e.message);
  }
}

function setSyncStatus(state, msg) {
  document.getElementById('sync-dot').className = 'drive-dot ' + state;
  document.getElementById('sync-status').textContent = msg;
}

window.exportBackup = function() {
  const data = {members, bungs, notices, exportedAt: new Date().toISOString()};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `kiku_backup_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

function updateNoticeDot() {
  const dot = document.getElementById('notice-dot');
  if (!dot) return;
  dot.style.display = notices.length > 0 ? '' : 'none';
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
        <div class="flex">
          <span class="notice-tag ${tagClass}">${tagLabel}</span>
          <strong style="font-size:14px">${n.title}</strong>
        </div>
        <div class="flex" style="gap:4px">
          ${isAdmin ? `<button class="btn btn-sm edit-only" onclick="event.stopPropagation();openEditNotice('${n.id}')"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-danger edit-only" onclick="event.stopPropagation();deleteNotice('${n.id}')"><i class="ti ti-trash"></i></button>` : ''}
        </div>
      </div>
      <div style="font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:6px">${n.content}</div>
      <div style="font-size:11px;color:var(--text3)">${n.authorName || '운영진'} · ${formatDate(date)}</div>
    </div>`;
  }).join('');
}

window.openNoticeDetail = function(id) {
  const n = notices.find(x => x.id === id);
  if (!n) return;
  const date = n.createdAt ? new Date(n.createdAt.seconds * 1000) : new Date();
  openModal(`<div class="modal-title">${n.pinned ? '📌 ' : ''}${n.title}</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">${n.authorName || '운영진'} · ${formatDate(date)}</div>
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
    authorEmail: currentUser.email,
    createdAt: serverTimestamp(),
  });
  closeModal();
};

window.openEditNotice = function(id) {
  const n = notices.find(x => x.id === id);
  if (!n) return;
  openModal(`<div class="modal-title"><i class="ti ti-edit" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>공지 수정</div>
    <div class="form-group"><label>제목</label><input type="text" id="en-title" value="${n.title}"></div>
    <div class="form-group"><label>내용</label><textarea id="en-content" style="min-height:120px">${n.content}</textarea></div>
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
    <img src="${url}" style="width:60px;height:60px;object-fit:cover;border-radius:var(--radius)">
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
      if (url) html += `<img src="${url}" style="max-width:100%;border-radius:var(--radius-lg);margin:10px 0;display:block">`;
    }
  }
  return html;
}

function authorDisplayName() {
  const me = getMyMember();
  return me ? me.name : (currentUser.displayName || currentUser.email);
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
    const displayName = p.anonymous ? '익명' : (p.authorName || '회원');
    const canManage = isAdmin || (currentUser && p.authorUid === currentUser.uid);
    const titleHtml = p.type === 'song' ? `<i class="ti ti-music" style="color:var(--purple);margin-right:4px"></i>${p.title}` : p.title;
    const previewText = (p.content||'').replace(/\[이미지\d+\]/g, '📷 ').trim();
    return `<div class="notice-card" onclick="openPostDetail('${p.id}')">
      <div class="flex-between mb-1">
        <strong style="font-size:14px">${titleHtml}</strong>
        <div class="flex" style="gap:4px">
          ${canManage ? `<button class="btn btn-sm" onclick="event.stopPropagation();openEditPost('${p.id}')"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deletePost('${p.id}')"><i class="ti ti-trash"></i></button>` : ''}
        </div>
      </div>
      <div style="font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:6px">${previewText}${p.images&&p.images.length>0?` <span style="color:var(--text3);font-size:11px">(사진 ${p.images.length}장)</span>`:''}</div>
      <div style="font-size:11px;color:var(--text3);display:flex;gap:8px;align-items:center">
        <span>${displayName} · ${formatDate(date)}</span>
        <span><i class="ti ti-message-circle" style="font-size:11px;vertical-align:-1px"></i> ${p.commentCount||0}</span>
      </div>
    </div>`;
  }).join('');
}

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
  let title, songName, artistName;
  if (isSong) {
    songName = document.getElementById('p-song').value.trim();
    artistName = document.getElementById('p-artist').value.trim();
    if (!songName) { alert('곡명을 입력해주세요.'); return; }
    title = artistName ? `${songName} - ${artistName}` : songName;
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
  if (isSong) { data.songName = songName; data.artistName = artistName; }
  await addDoc(collection(db, 'posts'), data);
  postImageFiles = [];
  closeModal();
};

window.openEditPost = function(id) {
  const p = posts.find(x => x.id === id);
  if (!p) return;
  editPostExistingImages = [...(p.images||[])];
  editPostImageFiles = [];
  openModal(`<div class="modal-title"><i class="ti ti-edit" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>글 수정</div>
    <div class="form-group"><label>제목</label><input type="text" id="ep-title" value="${p.title}"></div>
    <div class="form-group"><label>내용</label><textarea id="ep-content" style="min-height:140px">${p.content}</textarea></div>
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
  const displayName = p.anonymous ? '익명' : (p.authorName || '회원');
  wrap.innerHTML = `
    <button class="btn btn-sm" style="margin-bottom:12px" onclick="closePostDetail()"><i class="ti ti-arrow-left"></i> 목록으로</button>
    <div class="notice-card" style="cursor:default">
      <div style="font-size:17px;font-weight:500;margin-bottom:6px">${p.title}</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px">${displayName} · ${formatDate(date)}</div>
      <div style="font-size:14px;line-height:1.8">${(p.images&&p.images.length>0) ? renderPostBodyWithImages(p.content, p.images) : renderClampedText(p.content, 500)}</div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:13px;font-weight:500;margin-bottom:10px">댓글 ${postComments.length}개</div>
      <div id="comment-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
        ${postComments.length===0?'<div style="font-size:13px;color:var(--text2)">첫 댓글을 남겨보세요.</div>':postComments.map(c=>{
          const cdate = c.createdAt ? new Date(c.createdAt.seconds*1000) : new Date();
          const canDel = isAdmin || (currentUser && c.authorUid === currentUser.uid);
          return `<div style="background:var(--bg2);border-radius:var(--radius);padding:10px 12px">
            <div class="flex-between"><span style="font-size:12px;font-weight:500">${c.authorName}</span>
            ${canDel?`<button class="btn btn-sm" style="padding:2px 6px" onclick="deleteComment('${c.id}')"><i class="ti ti-trash" style="font-size:12px"></i></button>`:''}</div>
            <div style="font-size:13px;margin-top:4px">${renderClampedText(c.content, 300)}</div>
            <div style="font-size:10px;color:var(--text3);margin-top:4px">${formatDate(cdate)}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="flex" style="gap:8px">
        <input type="text" id="comment-input" placeholder="댓글을 입력하세요" style="flex:1" onkeydown="if(event.key==='Enter')addComment()">
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
window.openAddMember = function() {
  openModal(`<div class="modal-title"><i class="ti ti-user-plus" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>회원 추가</div>
    <div class="form-row"><div class="form-group"><label>이름</label><input type="text" id="m-name" placeholder="닉네임" autofocus></div><div class="form-group"><label>가입일</label><input type="date" id="m-join" value="${TODAY.toISOString().slice(0,10)}"></div></div>
    <div class="form-group"><label>메모 (선택)</label><textarea id="m-memo" placeholder="특이사항 등"></textarea></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="addMember()">추가</button></div>`);
};

window.addMember = async function() {
  const name = document.getElementById('m-name').value.trim();
  const joinDate = document.getElementById('m-join').value;
  if (!name || !joinDate) { alert('이름과 가입일을 입력해주세요.'); return; }
  const memo = document.getElementById('m-memo').value.trim();
  const numId = nextMemberId++;
  await addDoc(collection(db, 'members'), {numId, name, joinDate, lastAttend: null, contacted: false, memo});
  closeModal();
};

window.openEditMember = function(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  openModal(`<div class="modal-title"><i class="ti ti-edit" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>회원 수정 — ${m.name}</div>
    <div class="form-row"><div class="form-group"><label>이름</label><input type="text" id="e-name" value="${m.name}"></div><div class="form-group"><label>가입일</label><input type="date" id="e-join" value="${m.joinDate}"></div></div>
    <div class="form-group"><label>최근 참여일</label><input type="date" id="e-attend" value="${m.lastAttend||''}"></div>
    <div class="form-group"><label>생일 (선택)</label><input type="date" id="e-birthday" value="${m.birthday||''}"></div>
    <div class="form-group"><label>메모</label><textarea id="e-memo">${m.memo||''}</textarea></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="editMember('${id}')">저장</button></div>`);
};

window.editMember = async function(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  await updateDoc(doc(db, 'members', id), {
    name: document.getElementById('e-name').value.trim() || m.name,
    joinDate: document.getElementById('e-join').value || m.joinDate,
    lastAttend: document.getElementById('e-attend').value || null,
    birthday: document.getElementById('e-birthday').value || null,
    memo: document.getElementById('e-memo').value.trim(),
  });
  closeModal();
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
      ${unlinked.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}
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
    alert('프로필이 연결되었습니다.');
    return;
  }
  await updateDoc(doc(db, 'members', id), {
    linkPendingUid: currentUser.uid,
    linkPendingEmail: currentUser.email,
    linkPendingName: currentUser.displayName || currentUser.email,
  });
  closeModal();
  alert('연결 요청이 전송되었습니다. 운영진 확인 후 적용됩니다.');
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
  openModal(`<div class="modal-title"><i class="ti ti-crown" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>역할 지정 — ${m.name}</div>
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
};

// ── 프로필 커스텀 (본인만 수정 가능) ────────────────────────────────
window.openEditMyProfile = function(id) {
  const m = members.find(x => x.id === id);
  if (!m || !currentUser || m.linkedUid !== currentUser.uid) { alert('본인 프로필만 수정할 수 있습니다.'); return; }
  openModal(`<div class="modal-title"><i class="ti ti-user-circle" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>내 프로필 수정</div>
    <div class="form-group"><label>닉네임</label><input type="text" id="mp-name" value="${m.name}"></div>
    <div class="form-group"><label>프로필 사진</label>
      <div class="flex" style="gap:10px;align-items:center">
        ${m.photoURL?`<img src="${m.photoURL}" style="width:44px;height:44px;border-radius:50%;object-fit:cover">`:''}
        <input type="file" id="mp-photo" accept="image/*" style="flex:1">
      </div>
    </div>
    <div class="form-group"><label>한줄소개</label><input type="text" id="mp-bio" value="${m.bio||''}" placeholder="나를 소개해보세요" maxlength="60"></div>
    <div class="form-row">
      <div class="form-group"><label>최애 아티스트</label><input type="text" id="mp-artist" value="${m.favArtist||''}" placeholder="예: 요네즈 켄시"></div>
      <div class="form-group"><label>최애곡</label><input type="text" id="mp-song" value="${m.favSong||''}" placeholder="예: Lemon"></div>
    </div>
    <div class="form-group"><label>생일 (선택)</label><input type="date" id="mp-birthday" value="${m.birthday||''}"></div>
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
  } catch(e) {
    statusEl.textContent = '저장 실패: ' + e.message;
  }
};

// ── 벙 CRUD ───────────────────────────────────────────────────────
function memberSelectHTML(mode, checkedIds=[]) {
  return `<div style="display:flex;gap:6px;margin-bottom:6px">
    <input type="text" id="member-search${mode==='edit'?'-edit':''}" placeholder="이름 입력 후 엔터 또는 쉼표로 구분" style="flex:1" onkeydown="handleAttendeeInput(event,'${mode}')">
    <button class="btn btn-sm" onclick="handleAttendeeAdd('${mode}')" type="button">추가</button>
  </div>
  <div id="${mode}-tag-area" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:28px">${checkedIds.map(id=>{const m=members.find(x=>x.id===id);return m?`<span class="attendee-tag" data-id="${m.id}">${m.name} <span onclick="removeAttendeeTag(this,'${mode}')" style="cursor:pointer;margin-left:2px">×</span></span>`:''}).join('')}</div>
  <div class="attendee-scroll" id="${mode}-attendee-list">${members.map(m=>`<label class="attendee-label" data-name="${m.name}" data-id="${m.id}" onclick="toggleAttendeeTag(this,'${mode}')" style="cursor:pointer"><input type="checkbox" class="attend-check" value="${m.id}" ${checkedIds.includes(m.id)?'checked':''}> ${m.name}</label>`).join('')}</div>`;
}

window.openAddBung = function() {
  openModal(`<div class="modal-title"><i class="ti ti-calendar-plus" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>벙 추가</div>
    <div class="form-row"><div class="form-group"><label>벙 이름</label><input type="text" id="b-name" placeholder="6월 정모" autofocus></div><div class="form-group"><label>날짜</label><input type="date" id="b-date" value="${TODAY.toISOString().slice(0,10)}"></div></div>
    <div class="form-row"><div class="form-group"><label>구분</label><select id="b-type"><option value="정모">정모</option><option value="번개">번개</option></select></div><div class="form-group"><label>장소</label><input type="text" id="b-place" placeholder="홍대 코인노래방"></div></div>
    <div class="form-row"><div class="form-group"><label>시간</label><input type="text" id="b-time" placeholder="오후 7시 30분"></div><div class="form-group"><label>주제</label><input type="text" id="b-topic" placeholder="노래방"></div></div>
    <div class="form-group"><label>참석자 선택</label>${memberSelectHTML('add')}</div>
    <div class="form-group"><label>벙주 (참석자 중 선택)</label><select id="b-host"><option value="">선택 안 함</option></select></div>
    <div class="form-group"><label>메모</label><textarea id="b-memo" placeholder="후기 등"></textarea></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="addBung()">추가</button></div>`);
  setTimeout(() => updateHostSelect('add'), 50);
};

window.addBung = async function() {
  const name = document.getElementById('b-name').value.trim();
  const date = document.getElementById('b-date').value;
  if (!name || !date) { alert('벙 이름과 날짜를 입력해주세요.'); return; }
  const attendees = [...document.querySelectorAll('#add-attendee-list .attend-check:checked')].map(c => c.value);
  const hostVal = document.getElementById('b-host').value;
  const numId = nextBungId++;
  await addDoc(collection(db, 'bungs'), {
    numId, date, name, attendees,
    type: document.getElementById('b-type').value,
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
};

window.openEditBung = function(id) {
  const b = bungs.find(x => x.id === id);
  if (!b) return;
  openModal(`<div class="modal-title"><i class="ti ti-edit" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>벙 수정 — ${b.name}</div>
    <div class="form-row"><div class="form-group"><label>벙 이름</label><input type="text" id="eb-name" value="${b.name}"></div><div class="form-group"><label>날짜</label><input type="date" id="eb-date" value="${b.date}"></div></div>
    <div class="form-row"><div class="form-group"><label>구분</label><select id="eb-type"><option value="정모" ${b.type==='정모'?'selected':''}>정모</option><option value="번개" ${b.type==='번개'?'selected':''}>번개</option></select></div><div class="form-group"><label>장소</label><input type="text" id="eb-place" value="${b.place||''}"></div></div>
    <div class="form-row"><div class="form-group"><label>시간</label><input type="text" id="eb-time" value="${b.time||''}"></div><div class="form-group"><label>주제</label><input type="text" id="eb-topic" value="${b.topic||''}"></div></div>
    <div class="form-group"><label>참석자 선택</label>${memberSelectHTML('edit', b.attendees||[])}</div>
    <div class="form-group"><label>벙주 (참석자 중 선택)</label><select id="eb-host"><option value="">선택 안 함</option>${(b.attendees||[]).map(aid=>{const m=members.find(x=>x.id===aid);return m?`<option value="${m.id}" ${b.hostId===m.id?'selected':''}>${m.name}</option>`:''}).join('')}</select></div>
    <div class="form-group"><label>메모</label><textarea id="eb-memo">${b.memo||''}</textarea></div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-primary" onclick="editBung('${id}')">저장</button></div>`);
};

window.editBung = async function(id) {
  const b = bungs.find(x => x.id === id);
  if (!b) return;
  const attendees = [...document.querySelectorAll('#edit-attendee-list .attend-check:checked')].map(c => c.value);
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
};

window.deleteBung = async function(id) {
  const b = bungs.find(x => x.id === id);
  if (!b || !confirm(`"${b.name}" 벙을 삭제할까요?`)) return;
  await deleteDoc(doc(db, 'bungs', id));
  await recalcLastAttend();
};

async function recalcLastAttend() {
  for (const m of members) {
    let last = null;
    bungs.forEach(b => {
      if ((b.attendees||[]).includes(m.id)) {
        const d = new Date(b.date);
        if (!last || d > last) last = d;
      }
    });
    const newLast = last ? last.toISOString().slice(0,10) : null;
    const updates = {};
    if (newLast !== m.lastAttend) updates.lastAttend = newLast;
    // 부활 업적: lastAttend가 새로 갱신되는데 그 시점 상태가 유령/경고였다면 기록
    if (updates.lastAttend) {
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
    <div style="position:relative;aspect-ratio:1;overflow:hidden;border-radius:var(--radius-lg);background:var(--bg2);border:0.5px solid var(--border);cursor:pointer" onclick="openLightbox(${i})">
      <img src="${f.url}" style="width:100%;height:100%;object-fit:cover" loading="lazy" alt="${f.name}">
      ${isAdmin ? `<button onclick="event.stopPropagation();deletePhoto(${i})" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.55);color:#fff;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;display:none;align-items:center;justify-content:center;font-size:12px" class="del-btn edit-only"><i class="ti ti-x"></i></button>` : ''}
    </div>`).join('');
}

window.openLightbox = function(idx) {
  const existing = document.getElementById('kiku-lightbox');
  if (existing) existing.remove();
  const lb = document.createElement('div');
  lb.id = 'kiku-lightbox';
  lb.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:300;display:flex;align-items:center;justify-content:center;padding:1rem';
  lb.innerHTML = `<button onclick="document.getElementById('kiku-lightbox').remove()" style="position:absolute;top:1rem;right:1rem;color:#fff;font-size:24px;cursor:pointer;background:none;border:none"><i class="ti ti-x"></i></button>
    <img src="${galleryFiles[idx].url}" style="max-width:100%;max-height:90vh;object-fit:contain;border-radius:var(--radius)" alt="">`;
  lb.addEventListener('click', e => { if (e.target === lb) lb.remove(); });
  document.body.appendChild(lb);
};

window.uploadPhotos = async function(event) {
  const files = [...event.target.files];
  if (!files.length) return;
  const statusEl = document.getElementById('gallery-status');
  const statusText = document.getElementById('gallery-status-text');
  statusEl.style.display = 'flex';
  for (let i = 0; i < files.length; i++) {
    statusText.textContent = `업로드 중... (${i+1}/${files.length}) ${files[i].name}`;
    const storageRef = ref(storage, `gallery/${Date.now()}_${files[i].name}`);
    await uploadBytes(storageRef, files[i]);
  }
  statusText.textContent = '업로드 완료!';
  setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
  event.target.value = '';
  await loadGallery();
};

window.deletePhoto = async function(idx) {
  if (!confirm(`사진을 삭제할까요?`)) return;
  await deleteObject(galleryFiles[idx].ref);
  galleryFiles.splice(idx, 1);
  renderGallery();
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
function formatDate(d) {
  if (!d) return '-';
  const dt = typeof d==='string' ? new Date(d) : d;
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

function getRecentMemberStats() {
  const cd = getCalcDate();
  const twoMonthsAgo = new Date(cd);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth()-2);
  const recentBungs = bungs.filter(b => new Date(b.date) >= twoMonthsAgo && new Date(b.date) <= TODAY);
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
    result.pioneer = {uid: p.authorUid, name: p.anonymous ? '익명' : (p.authorName||'회원')};
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
    if (firstPost) result.hottrack = {uid: firstPost.authorUid, name: firstPost.anonymous?'익명':(firstPost.authorName||'회원'), song: firstPost.songName};
  }

  // 5. 이달의 수다왕 — 이번 달 게시글+댓글 합산 최다 (댓글은 postComments 서브컬렉션이라 실시간 집계가 어려워 게시글 수로 근사)
  const postCounts = {};
  monthPosts.forEach(p => { if (p.authorUid) postCounts[p.authorUid] = (postCounts[p.authorUid]||0) + 1 + (p.commentCount||0); });
  const chattyEntries = Object.entries(postCounts).sort((a,b)=>b[1]-a[1]);
  if (chattyEntries.length > 0 && chattyEntries[0][1] >= 1) {
    const samplePost = monthPosts.find(p => p.authorUid === chattyEntries[0][0]);
    result.chatty = {uid: chattyEntries[0][0], name: samplePost?.anonymous?'익명':(samplePost?.authorName||'회원'), count: chattyEntries[0][1]};
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
      <div style="font-size:13px;font-weight:500;color:${a?'var(--warn)':'var(--text2)'}">${a?a.name:'아직 없음'}</div>
    </div>`;
  }).join('');
  const historyHTML = pastRecords.length === 0 ? '' : `
    <div style="font-size:12px;font-weight:500;color:var(--text2);margin:14px 0 8px">📜 지난 기록</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${pastRecords.map(rec => {
        const items = SEASON_AWARD_DEFS.filter(def => rec.awards[def.id]).map(def => {
          const a = rec.awards[def.id];
          return `<span title="${def.label} · ${a.name}" style="font-size:13px;background:var(--bg2);border:0.5px solid var(--border);border-radius:20px;padding:3px 9px">${def.icon} ${a.name}</span>`;
        }).join('');
        return `<div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">${rec.ym}</div>
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
}

function renderDashboard() {
  const cd = getCalcDate();
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
    const upcoming = bungs.filter(b=>new Date(b.date)>TODAY).sort((a,b)=>new Date(a.date)-new Date(b.date));
    const nextBung = upcoming[0]||null;
    if (nextBung) {
      const daysLeft = daysBetween(TODAY, new Date(nextBung.date));
      const d = new Date(nextBung.date);
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
            <div style="font-size:11px;color:var(--text2);font-weight:500;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px">다음 예정 벙</div>
            <div style="font-size:22px;font-weight:500;margin-bottom:10px">${nextBung.name}</div>
            <div style="display:flex;gap:14px;flex-wrap:wrap">
              <span style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px"><i class="ti ti-calendar" style="font-size:14px;color:var(--info)"></i>${d.getMonth()+1}월 ${d.getDate()}일(${weekdays[d.getDay()]})</span>
              ${nextBung.place?`<span style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px"><i class="ti ti-map-pin" style="font-size:14px;color:var(--danger)"></i>${nextBung.place}</span>`:''}
              ${nextBung.time?`<span style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px"><i class="ti ti-clock" style="font-size:14px;color:var(--success)"></i>${nextBung.time}</span>`:''}
              ${host?`<span style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px"><i class="ti ti-crown" style="font-size:14px;color:var(--warn)"></i>${host.name}</span>`:''}
            </div>
          </div>
          <div style="text-align:center;flex-shrink:0">
            <div class="hero-dday">${daysLeft}</div>
            <div style="font-size:13px;color:var(--info);font-weight:500;margin-top:2px">일 후</div>
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
  const hasGhost = c.ghost>0||c.warn>0;
  if (ghostEl) ghostEl.innerHTML = `<div class="stat-card-big" style="${hasGhost?'border-color:var(--danger-border)':''}">
    <div class="stat-card-icon">👻</div>
    <div style="font-size:11px;color:var(--text2);font-weight:500;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:12px">유령 현황</div>
    <div style="display:flex;gap:20px;margin-bottom:14px">
      <div><div style="font-size:36px;font-weight:500;line-height:1;color:${c.ghost>0?'var(--danger)':'var(--text)'}">${c.ghost}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">퇴출 대상</div></div>
      <div style="width:0.5px;background:var(--border)"></div>
      <div><div style="font-size:36px;font-weight:500;line-height:1;color:${c.warn>0?'var(--warn)':'var(--text)'}">${c.warn}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">연락 완료</div></div>
    </div>
    <button class="btn btn-sm ${hasGhost?'btn-danger':''}" onclick="switchTab('ghost')" style="font-size:12px;width:100%">유령 정리 탭 →</button>
  </div>`;

  const recentEl = document.getElementById('dash-recent-bung');
  if (recentEl) {
    const recent = [...bungs].filter(b=>new Date(b.date)<=TODAY).slice(0,4);
    recentEl.innerHTML = `<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1.25rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:13px;font-weight:500">최근 벙</div>
        <button class="btn btn-sm" onclick="switchTab('bung')" style="font-size:11px">전체 →</button>
      </div>
      ${recent.length===0?'<div style="font-size:13px;color:var(--text2)">기록된 벙이 없습니다.</div>':
      recent.map((b,i)=>{
        const names=(b.attendees||[]).map(id=>{const m=members.find(x=>x.id===id);return m?m.name[0]:'?'});
        const typeBadge=b.type==='번개'?'<span class="badge badge-bungae">번개</span>':'<span class="badge badge-jeongmo">정모</span>';
        return `<div class="timeline-item" style="${i===recent.length-1?'border-bottom:none':''}">
          <div style="display:flex;flex-direction:column;align-items:center;padding-top:4px">
            <div class="timeline-dot"></div>
            ${i<recent.length-1?'<div class="timeline-line" style="flex:1;margin-top:4px"></div>':''}
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">${typeBadge}<strong style="font-size:13px">${b.name}</strong></div>
            <div style="font-size:12px;color:var(--text2);margin-bottom:6px">${formatDate(b.date)}${b.place?` · ${b.place}`:''}</div>
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
        ${mvp.photoURL?`<img src="${mvp.photoURL}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0">`:`<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--warn-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:500;flex-shrink:0">${mvp.name[0]}</div>`}
        <div><div style="font-weight:500">${mvp.name}</div><div style="font-size:12px;color:var(--text2);margin-top:2px">이번 달 ${mvp.count}/${mvp.total}회 참석</div></div>
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
      `<div style="display:flex;flex-wrap:wrap;gap:6px">${newbies.map(m=>`<span style="font-size:12px;padding:3px 10px;border-radius:20px;background:var(--success-bg);color:var(--success);font-weight:500">${m.name}</span>`).join('')}</div>`}
    </div>`;
  }

  const annexEl = document.getElementById('dash-anniversary');
  if (annexEl) {
    const upcoming14 = members.map(m=>{
      if (!m.joinDate) return null;
      const join = new Date(m.joinDate);
      const years = TODAY.getFullYear()-join.getFullYear();
      if (years < 1) return null;
      const anniv = new Date(TODAY.getFullYear(), join.getMonth(), join.getDate());
      const diff = Math.floor((anniv-TODAY)/(1000*60*60*24));
      if (diff < 0 || diff > 14) return null;
      return {...m, years, diff};
    }).filter(Boolean).sort((a,b)=>a.diff-b.diff);
    annexEl.innerHTML = `<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem">
      <div style="font-size:12px;font-weight:500;color:var(--text2);letter-spacing:0.4px;text-transform:uppercase;margin-bottom:10px">🎂 다가오는 기념일</div>
      ${upcoming14.length===0?'<div style="font-size:13px;color:var(--text2)">2주 내 기념일 없음</div>':
      `<div style="display:flex;flex-direction:column;gap:6px">${upcoming14.map(m=>`<div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;font-weight:500">${m.name} <span style="font-size:11px;color:var(--warn)">${m.years}주년</span></div>
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
  const fromPlaylist = playlist.map(p => ({songName:p.songName, artistName:p.artistName||'', source:'playlist', addedBy:p.addedBy||'운영진'}));
  const fromBoard = posts.filter(p=>p.type==='song' && p.songName).map(p => ({songName:p.songName, artistName:p.artistName||'', source:'board', addedBy:p.anonymous?'익명':(p.authorName||'회원')}));
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
    <div style="font-size:18px;font-weight:600">${pick.songName}</div>
    ${pick.artistName?`<div style="font-size:13px;color:var(--text2);margin-top:2px">${pick.artistName}</div>`:''}
    <div style="font-size:11px;color:var(--text3);margin-top:8px">${sourceLabel} · 추천곡 ${pool.length}개 중 오늘의 선곡</div>
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
    <div><span style="font-size:13px;font-weight:500">${p.songName}</span>${p.artistName?`<span style="font-size:12px;color:var(--text2);margin-left:6px">${p.artistName}</span>`:''}</div>
    <button class="btn btn-sm btn-danger" onclick="deletePlaylistSong('${p.id}')"><i class="ti ti-trash"></i></button>
  </div>`).join('');
}

window.addPlaylistSong = async function() {
  if (!isAdmin) return;
  const songName = document.getElementById('pl-song').value.trim();
  const artistName = document.getElementById('pl-artist').value.trim();
  if (!songName) { alert('곡명을 입력해주세요.'); return; }
  await addDoc(collection(db, 'playlist'), {songName, artistName, addedBy: currentUser.displayName||currentUser.email, createdAt: serverTimestamp()});
  document.getElementById('pl-song').value = '';
  document.getElementById('pl-artist').value = '';
};

window.deletePlaylistSong = async function(id) {
  if (!isAdmin) return;
  await deleteDoc(doc(db, 'playlist', id));
};

function renderDashboardAlerts() {
  const cd = getCalcDate();
  const el = document.getElementById('dashboard-alerts');
  if (!el) return;
  if (isCalcDay()) {
    el.innerHTML = `<div class="alert alert-danger"><i class="ti ti-alert-triangle"></i><div><strong>오늘이 유령 회원 정리일입니다!</strong> 유령 정리 탭에서 조치 후 초기화를 진행해주세요.</div></div>`;
  } else {
    const diff = daysBetween(TODAY, cd);
    el.innerHTML = diff <= 7
      ? `<div class="alert alert-warning"><i class="ti ti-clock"></i>다음 유령 정리일까지 <strong>${diff}일</strong> 남았습니다. (${formatDate(cd)})</div>`
      : `<div class="alert alert-info"><i class="ti ti-info-circle"></i>다음 유령 정리일: <strong>${formatDate(cd)}</strong> (${diff}일 후)</div>`;
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
          <div style="flex:1"><div style="font-size:13px;font-weight:500">${x.m.name}</div>
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
            <span style="font-size:16px">${a.icon}</span><span style="font-weight:500">${a.member}</span><span style="color:var(--text2)">${a.label}</span>
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
    ${pending.map(m=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--bg);border-radius:var(--radius);padding:8px 12px">
      <span style="font-size:13px">"<strong>${m.linkPendingName}</strong>"님이 <strong>${m.name}</strong> 회원으로 연결을 요청했습니다.</span>
      <div class="flex" style="gap:6px;flex-shrink:0">
        <button class="btn btn-sm btn-primary" onclick="approveProfileLink('${m.id}')">승인</button>
        <button class="btn btn-sm btn-danger" onclick="rejectProfileLink('${m.id}')">거부</button>
      </div>
    </div>`).join('')}
  </div>`;
}

function renderMembers() {
  const cd = getCalcDate();
  const tbody = document.getElementById('member-tbody');
  const empty = document.getElementById('member-empty');
  if (!tbody) return;
  if (members.length === 0) { tbody.innerHTML = ''; empty.style.display='block'; return; }
  empty.style.display = 'none';
  const sortVal = document.getElementById('member-sort')?.value || 'join';
  const sorted = [...members].sort((a,b)=>{
    if (sortVal==='name') return a.name.localeCompare(b.name,'ko');
    if (sortVal==='rate') {
      const ra = bungs.length>0?bungs.filter(bng=>(bng.attendees||[]).includes(a.id)).length/bungs.length:0;
      const rb = bungs.length>0?bungs.filter(bng=>(bng.attendees||[]).includes(b.id)).length/bungs.length:0;
      return rb-ra;
    }
    return new Date(a.joinDate)-new Date(b.joinDate);
  });
  const badgeMap = {ghost:'<span class="badge badge-ghost">유령 대상</span>',contacted:'<span class="badge badge-contact">연락 완료</span>',safe:'<span class="badge badge-safe">정상</span>',new:'<span class="badge badge-new">신규</span>'};
  tbody.innerHTML = sorted.map(m=>{
    const status = getMemberStatus(m, cd);
    const rc = status==='ghost'?' class="member-row-ghost"':'';
    const attended = bungs.filter(b=>(b.attendees||[]).includes(m.id)).length;
    const rate = bungs.length>0?Math.round(attended/bungs.length*100):0;
    const grade = getMemberGrade(rate);
    const gradeBadge = `<span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:${grade.bg};color:${grade.color};font-weight:500">${grade.label}</span>`;
    const memo = m.memo?`<div class="memo-text">📝 ${m.memo}</div>`:'<span style="color:var(--text3);font-size:12px">-</span>';
    const linkBadge = m.linkedUid ? `<i class="ti ti-link" style="color:var(--success);font-size:12px;margin-left:4px" title="계정 연결됨"></i>` : '';
    const roleLabel = m.role==='admin' ? '운영진' : m.role==='host' ? '모임장' : '';
    const roleBadge = roleLabel ? `<span style="font-size:10px;background:var(--warn-bg);color:var(--warn);padding:1px 5px;border-radius:3px;margin-left:4px">${roleLabel}</span>` : '';
    return `<tr${rc}><td><strong>${m.name}</strong>${linkBadge}${roleBadge}</td><td>${formatDate(m.joinDate)}</td><td>${m.lastAttend?formatDate(m.lastAttend):'<span style="color:var(--text2)">없음</span>'}</td><td style="text-align:center"><input type="checkbox" class="contact-check" ${m.contacted?'checked':''} onchange="toggleContact('${m.id}',this.checked)" ${isAdmin?'':' disabled'}></td><td>${badgeMap[status]}</td><td>${gradeBadge}</td><td>${memo}</td><td class="edit-only"><div class="flex" style="gap:4px"><button class="btn btn-sm" onclick="openEditMember('${m.id}')"><i class="ti ti-edit"></i></button><button class="btn btn-sm" onclick="openSetRole('${m.id}')" title="역할 지정"><i class="ti ti-crown"></i></button>${m.linkedUid?`<button class="btn btn-sm" onclick="unlinkProfile('${m.id}')" title="연결 해제"><i class="ti ti-unlink"></i></button>`:''}<button class="btn btn-sm btn-danger" onclick="deleteMember('${m.id}')"><i class="ti ti-trash"></i></button></div></td></tr>`;
  }).join('');
}

function renderBungs() {
  const el = document.getElementById('bung-list');
  if (!el) return;
  const sorted = [...bungs];
  if (sorted.length === 0) { el.innerHTML='<div class="empty-state"><i class="ti ti-calendar-off"></i>등록된 벙이 없습니다.</div>'; return; }
  el.innerHTML = sorted.map(b=>{
    const isPast = new Date(b.date) <= TODAY;
    const names = (b.attendees||[]).map(id=>{const m=members.find(x=>x.id===id);return m?m.name:'?'});
    const host = b.hostId ? members.find(x=>x.id===b.hostId) : null;
    const typeBadge = b.type==='번개'?'<span class="badge badge-bungae">번개</span>':'<span class="badge badge-jeongmo">정모</span>';
    const settledBadge = b.settlement ? '<span class="badge badge-safe"><i class="ti ti-receipt-2" style="font-size:11px"></i> 정산완료</span>' : '';
    return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem 1.25rem;margin-bottom:10px">
      <div class="flex-between mb-1">
        <div class="flex">${typeBadge}<strong>${b.name}</strong>${isPast?'<span class="badge badge-safe">완료</span>':'<span class="badge badge-new">예정</span>'}${settledBadge}</div>
        <div class="flex" style="gap:4px">
          <button class="btn btn-sm btn-info" onclick="openTemplate('${b.id}')"><i class="ti ti-speakerphone"></i> 공지</button>
          ${isPast?`<button class="btn btn-sm" onclick="openBungRecap('${b.id}')"><i class="ti ti-sparkles"></i> 회고</button>`:''}
          <button class="btn btn-sm" onclick="openSettlement('${b.id}')"><i class="ti ti-calculator"></i> 정산</button>
          <button class="btn btn-sm edit-only" onclick="openEditBung('${b.id}')"><i class="ti ti-edit"></i> 수정</button>
          <button class="btn btn-sm btn-danger edit-only" onclick="deleteBung('${b.id}')"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text2);display:flex;gap:12px;flex-wrap:wrap;margin-top:4px">
        <span><i class="ti ti-calendar" style="font-size:13px"></i> ${formatDate(b.date)}</span>
        ${b.place?`<span><i class="ti ti-map-pin" style="font-size:13px"></i> ${b.place}</span>`:''}
        ${host?`<span><i class="ti ti-crown" style="font-size:13px"></i> ${host.name}</span>`:''}
        <span><i class="ti ti-users" style="font-size:13px"></i> ${names.join(', ')||'없음'} (${names.length}명)</span>
      </div>
      ${b.memo?`<div class="memo-text" style="margin-top:6px">📝 ${b.memo}</div>`:''}
    </div>`;
  }).join('');
}

function renderGhost() {
  const cd = getCalcDate();
  const twoMonthsAgo = new Date(cd);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth()-2);
  const gcEl = document.getElementById('ghost-calc-info');
  if (gcEl) gcEl.textContent = `기산일: ${formatDate(cd)} | 대상: ${formatDate(twoMonthsAgo)} ~ ${formatDate(cd)}`;
  const resetBtn = document.getElementById('reset-btn');
  const alertEl = document.getElementById('ghost-alert-area');
  if (alertEl) alertEl.innerHTML = isCalcDay()
    ? `<div class="alert alert-danger"><i class="ti ti-alert-triangle"></i><div><strong>오늘이 정리일입니다.</strong> 목록 확인 후 조치 완료 시 초기화를 실행하세요.</div></div>`
    : `<div class="alert alert-info"><i class="ti ti-clock"></i>다음 정리일까지 <strong>${daysBetween(TODAY,cd)}일</strong> 남았습니다. 현재는 미리보기입니다.</div>`;
  if (resetBtn) resetBtn.style.display = isCalcDay() ? '' : 'none';
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
      html += '<div style="border:0.5px solid var(--danger-border);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:1rem"><table><thead><tr><th>이름</th><th>가입일</th><th>마지막 참여</th><th>조건1</th><th>조건2</th><th>조건3</th></tr></thead><tbody>';
      ghostList.forEach(m=>{
        const c1=new Date(m.joinDate)<=twoMonthsAgo?'<span style="color:var(--danger)">✗ 2달↑</span>':'<span style="color:var(--success)">✓ 신규</span>';
        const la=m.lastAttend?new Date(m.lastAttend):null;
        const c2=(!la||la<twoMonthsAgo)?'<span style="color:var(--danger)">✗ 미참여</span>':'<span style="color:var(--success)">✓ 참여</span>';
        const c3=m.contacted?'<span style="color:var(--success)">✓ 연락</span>':'<span style="color:var(--danger)">✗ 미연락</span>';
        html+=`<tr class="member-row-ghost"><td><strong>${m.name}</strong></td><td>${formatDate(m.joinDate)}</td><td>${m.lastAttend?formatDate(m.lastAttend):'없음'}</td><td>${c1}</td><td>${c2}</td><td>${c3}</td></tr>`;
      });
      html += '</tbody></table></div>';
    }
    if (warnList.length>0) {
      html += `<div class="section-label">연락 완료 — 유예 (${warnList.length}명)</div>`;
      html += '<div style="border:0.5px solid var(--warn-border);border-radius:var(--radius-lg);overflow:hidden"><table><thead><tr><th>이름</th><th>가입일</th><th>마지막 참여</th></tr></thead><tbody>';
      warnList.forEach(m=>{html+=`<tr><td><strong>${m.name}</strong></td><td>${formatDate(m.joinDate)}</td><td>${m.lastAttend?formatDate(m.lastAttend):'없음'}</td></tr>`;});
      html += '</tbody></table></div>';
    }
  }
  tableEl.innerHTML = html;
}

function renderStats() {
  const el = document.getElementById('stats-content');
  if (!el) return;
  const cd = getCalcDate();
  const twoMonthsAgo = new Date(cd);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth()-2);
  const recentBungCount = bungs.filter(b => new Date(b.date) >= twoMonthsAgo && new Date(b.date) <= TODAY).length;
  const stats = getRecentMemberStats();
  if (members.length===0) { el.innerHTML='<div class="empty-state"><i class="ti ti-chart-bar"></i>벙과 회원 데이터가 있어야 통계를 볼 수 있어요.</div>'; return; }
  if (recentBungCount===0) { el.innerHTML='<div class="empty-state"><i class="ti ti-chart-bar"></i>최근 2개월간 진행된 벙이 없어요.<br><span style="font-size:12px">전체 역대 기록은 명예의 전당에서 확인하세요.</span></div>'; return; }
  const top3 = stats.filter(s=>s.attended>0).slice(0,3);
  const medals = ['🥇','🥈','🥉'];
  const gradeCount = {우수:stats.filter(s=>s.rate>=60).length, 활동:stats.filter(s=>s.rate>=20&&s.rate<60).length, 일반:stats.filter(s=>s.rate<20).length};
  el.innerHTML = `
  <div class="alert alert-info" style="margin-bottom:1.25rem"><i class="ti ti-info-circle"></i>최근 2개월(${formatDate(twoMonthsAgo)} ~ ${formatDate(TODAY)}, 유령 판정 기준과 동일) 활동성 통계입니다. 전체 역대 기록은 <strong>명예의 전당</strong>을 확인하세요.</div>
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
        <div style="flex:1"><div style="font-weight:500">${s.name} <span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:${s.grade.bg};color:${s.grade.color};font-weight:500">${s.grade.label}</span></div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${s.attended}회 / 최근 ${recentBungCount}회</div></div>
        <div style="font-size:20px;font-weight:500;color:${s.grade.color}">${s.rate}%</div>
      </div>`).join('')}
    </div>
  </div>
  <div><h3>전체 회원 최근 2개월 참여율</h3>
    <div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">
      <table><thead><tr><th>순위</th><th>이름</th><th>등급</th><th>참석</th><th>참여율</th><th>그래프</th></tr></thead><tbody>
      ${stats.map((s,i)=>`<tr><td style="color:var(--text2)">${i+1}</td><td><strong>${s.name}</strong></td>
        <td><span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:${s.grade.bg};color:${s.grade.color};font-weight:500">${s.grade.label}</span></td>
        <td>${s.attended}회</td><td style="font-weight:500;color:${s.grade.color}">${s.rate}%</td>
        <td style="min-width:80px"><div style="background:var(--bg3);border-radius:4px;height:8px;overflow:hidden"><div style="width:${s.rate}%;background:${s.grade.color};height:100%;border-radius:4px"></div></div></td>
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
    <div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:12px">
      <table><thead><tr><th>월</th><th>횟수</th><th>정모</th><th>번개</th><th>평균 참석</th><th>그래프</th></tr></thead><tbody>
      ${months.map(k=>{
        const m=monthMap[k];const avg=m.count>0?Math.round(m.attendTotal/m.count):0;const [y,mo]=k.split('-');
        return `<tr><td><strong>${y}년 ${parseInt(mo)}월</strong></td><td>${m.count}회</td>
          <td><span class="badge badge-jeongmo">${m.jeongmo}</span></td><td><span class="badge badge-bungae">${m.bungae}</span></td><td>${avg}명</td>
          <td style="min-width:100px"><div style="background:var(--bg3);border-radius:4px;height:8px;overflow:hidden"><div style="width:${Math.round(m.count/maxCount*100)}%;background:var(--info);height:100%;border-radius:4px"></div></div></td>
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
  const thisMonthBungs = bungs.filter(b=>b.date.startsWith(thisMonth)&&b.hostId);
  const hostCount = {};
  thisMonthBungs.forEach(b=>{hostCount[b.hostId]=(hostCount[b.hostId]||0)+1;});
  const topHostId = Object.keys(hostCount).sort((a,b)=>hostCount[b]-hostCount[a])[0];
  const topHost = topHostId ? members.find(x=>x.id===topHostId) : null;
  const anniversaries = members.filter(m=>{
    if (!m.joinDate) return false;
    const join=new Date(m.joinDate);const years=TODAY.getFullYear()-join.getFullYear();if(years<1)return false;
    const anniv=new Date(TODAY.getFullYear(),join.getMonth(),join.getDate());
    return Math.abs(daysBetween(TODAY,anniv))<=7;
  }).map(m=>({...m,years:TODAY.getFullYear()-new Date(m.joinDate).getFullYear()}));
  const streakRanking = members.map(m=>{
    const sortedB=[...bungs].sort((a,b)=>new Date(a.date)-new Date(b.date));
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
    const mb=bungs.filter(b=>b.date.startsWith(ym));if(mb.length===0)continue;
    const ac={};mb.forEach(b=>(b.attendees||[]).forEach(id=>{ac[id]=(ac[id]||0)+1;}));
    const topId=Object.keys(ac).sort((a,b)=>ac[b]-ac[a])[0];
    const mvp=topId?members.find(x=>x.id===topId):null;
    if(mvp)monthMVPs.push({ym:`${d.getFullYear()}년 ${d.getMonth()+1}월`,name:mvp.name,count:ac[topId],total:mb.length});
  }
  el.innerHTML = `
  <div class="hall-card"><h3>👑 이달의 벙주 (${TODAY.getMonth()+1}월)</h3>
    ${topHost?`<div style="display:flex;align-items:center;gap:16px;padding:8px 0">
      ${topHost.photoURL?`<img src="${topHost.photoURL}" style="width:52px;height:52px;border-radius:50%;object-fit:cover">`:`<div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--warn-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:500">${topHost.name[0]}</div>`}
      <div><div style="font-size:18px;font-weight:500">${topHost.name}</div><div style="font-size:13px;color:var(--text2);margin-top:3px">이번 달 ${hostCount[topHostId]}회 벙주</div></div>
      <div style="margin-left:auto;font-size:36px">👑</div></div>`:'<div style="font-size:13px;color:var(--text2);padding:8px 0">이번 달 벙주 기록 없음</div>'}
  </div>
  ${anniversaries.length>0?`<div class="hall-card"><h3>🎂 이번 주 가입 기념일</h3>
    ${anniversaries.map(m=>`<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:0.5px solid var(--border)">
      <span style="font-size:24px">🎉</span><div><strong>${m.name}</strong><span class="anniversary-badge">${m.years}주년</span>
      <div style="font-size:12px;color:var(--text2)">가입일: ${formatDate(m.joinDate)}</div></div></div>`).join('')}
  </div>`:''}
  <div class="hall-card"><h3>🏆 역대 참여율 명예의 전당</h3>
    ${bungs.length===0?'<div style="font-size:13px;color:var(--text2)">벙 데이터가 없습니다.</div>':
    `<div style="display:flex;flex-direction:column;gap:10px">${top3.map((s,i)=>`
      <div style="display:flex;align-items:center;gap:14px;background:var(--bg3);border-radius:var(--radius-lg);padding:12px 14px">
        <div style="font-size:28px">${medals[i]}</div>
        <div style="flex:1"><div style="font-weight:500">${s.name} <span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:${s.grade.bg};color:${s.grade.color};font-weight:500">${s.grade.label}</span></div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${s.attended}회 / 전체 ${bungs.length}회</div>
        <div style="background:var(--bg);border-radius:4px;height:5px;overflow:hidden;margin-top:6px"><div style="width:${s.rate}%;background:${s.grade.color};height:100%;border-radius:4px"></div></div></div>
        <div style="font-size:22px;font-weight:500;color:${s.grade.color}">${s.rate}%</div>
      </div>`).join('')}</div>`}
  </div>
  ${streakRanking.length>0?`<div class="hall-card"><h3>🔥 연속 참석 스트릭 랭킹</h3>
    <div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">
      <table><thead><tr><th>순위</th><th>이름</th><th>최장 연속</th><th>그래프</th></tr></thead><tbody>
      ${streakRanking.map((m,i)=>`<tr><td style="color:var(--text2)">${i+1}</td><td><strong>${m.name}</strong></td>
        <td style="color:var(--warn);font-weight:500">${m.maxStreak}회</td>
        <td style="min-width:80px"><div style="background:var(--bg3);border-radius:4px;height:7px;overflow:hidden"><div style="width:${Math.round(m.maxStreak/streakRanking[0].maxStreak*100)}%;background:var(--warn);height:100%;border-radius:4px"></div></div></td>
      </tr>`).join('')}
      </tbody></table></div></div>`:''}
  ${hostRanking.length>0?`<div class="hall-card"><h3>🎙️ 벙주 랭킹</h3>
    <div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">
      <table><thead><tr><th>순위</th><th>이름</th><th>전체</th><th>정모</th></tr></thead><tbody>
      ${hostRanking.map((m,i)=>`<tr><td>${i===0?'👑':i===1?'🥈':i===2?'🥉':i+1}</td><td><strong>${m.name}</strong></td>
        <td style="font-weight:500">${m.hosted}회</td><td style="color:var(--info)">${m.jeongmoHosted}회</td></tr>`).join('')}
      </tbody></table></div></div>`:''}
  ${monthMVPs.length>0?`<div class="hall-card"><h3>📅 월별 MVP 히스토리</h3>
    <div style="display:flex;flex-direction:column;gap:8px">${monthMVPs.map(m=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--border)">
        <div style="font-size:12px;color:var(--text2);min-width:80px">${m.ym}</div>
        <div style="flex:1;padding:0 12px"><strong>${m.name}</strong></div>
        <div style="font-size:12px;color:var(--text2)">${m.count}/${m.total}회</div>
      </div>`).join('')}</div></div>`:''}
  ${renderSeasonAwardsCard()}
  <div class="hall-card"><h3>🏅 개인 업적 현황</h3>
    ${members.length===0?'<div style="font-size:13px;color:var(--text2)">회원 데이터가 없습니다.</div>':
    '<div style="display:flex;flex-direction:column;gap:4px">'+
    members.map(m=>{const achvs=getAchievements(m);const unlocked=achvs.filter(a=>a.unlocked);if(unlocked.length===0)return '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border)">
        <div style="font-size:13px;font-weight:500;min-width:60px">${m.name}</div>
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
  let html=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <button class="btn btn-sm" onclick="calNav(-1)"><i class="ti ti-chevron-left"></i></button>
    <div style="font-size:16px;font-weight:500">${y}년 ${m+1}월</div>
    <button class="btn btn-sm" onclick="calNav(1)"><i class="ti ti-chevron-right"></i></button>
  </div>
  <div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem;margin-bottom:1rem">
    <div class="cal-grid" style="margin-bottom:4px">${weekdays.map(d=>`<div class="cal-header">${d}</div>`).join('')}</div>
    <div class="cal-grid">`;
  for(let i=firstDay-1;i>=0;i--) html+=`<div class="cal-day other-month"><div class="cal-day-num">${daysInPrev-i}</div></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const dateStr=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday=TODAY.getFullYear()===y&&TODAY.getMonth()===m&&TODAY.getDate()===d;
    const dayBungs=bungs.filter(b=>b.date===dateStr);
    html+=`<div class="cal-day${isToday?' today':''}"><div class="cal-day-num">${d}</div>${dayBungs.map(b=>`<div class="cal-event ${b.type==='번개'?'bungae':'jeongmo'}" onclick="showCalBungDetail('${b.id}')" title="${b.name}">${b.name}</div>`).join('')}</div>`;
  }
  const remaining=(7-((firstDay+daysInMonth)%7))%7;
  for(let d=1;d<=remaining;d++) html+=`<div class="cal-day other-month"><div class="cal-day-num">${d}</div></div>`;
  html+=`</div></div>`;
  if(monthBungs.length>0){
    html+=`<div style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem">
      <div style="font-size:13px;font-weight:500;margin-bottom:10px">${m+1}월 벙 목록</div>
      ${monthBungs.sort((a,b)=>new Date(a.date)-new Date(b.date)).map(b=>{
        const host=b.hostId?members.find(x=>x.id===b.hostId):null;
        const isPast=new Date(b.date)<=TODAY;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:0.5px solid var(--border)">
          ${b.type==='번개'?'<span class="badge badge-bungae">번개</span>':'<span class="badge badge-jeongmo">정모</span>'}
          <div style="flex:1"><div style="font-size:13px;font-weight:500">${b.name}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${formatDate(b.date)}${b.place?` · ${b.place}`:''}${host?` · 벙주: ${host.name}`:''}</div></div>
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
  const sorted=[...members].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  el.innerHTML=`<div style="margin-bottom:12px"><input type="text" placeholder="회원 검색..." oninput="filterProfileList(this.value)" style="width:100%;max-width:300px"></div>
  <div id="profile-list-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
    ${sorted.map(m=>{
      const attended=bungs.filter(b=>(b.attendees||[]).includes(m.id)).length;
      const rate=bungs.length>0?Math.round(attended/bungs.length*100):0;
      const grade=getMemberGrade(rate);
      const achvCount=getAchievements(m).filter(a=>a.unlocked).length;
      return `<div onclick="openProfile('${m.id}')" style="background:var(--bg);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem;cursor:pointer" onmouseover="this.style.borderColor='var(--text2)'" onmouseout="this.style.borderColor='var(--border)'">
        ${m.photoURL?`<img src="${m.photoURL}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;margin-bottom:8px">`:`<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--purple-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:500;margin-bottom:8px">${m.name[0]}</div>`}
        <div style="font-size:13px;font-weight:500;margin-bottom:4px">${m.name}</div>
        <div style="font-size:11px;padding:2px 6px;border-radius:var(--radius);background:${grade.bg};color:${grade.color};font-weight:500;display:inline-block;margin-bottom:6px">${grade.label}</div>
        <div style="font-size:11px;color:var(--text2)">${rate}% · 업적 ${achvCount}개</div>
      </div>`;
    }).join('')}
  </div>`;
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
  const joinDate=new Date(m.joinDate);
  const daysSinceJoin=daysBetween(joinDate,TODAY);
  const sortedBungs=[...bungs].sort((a,b)=>new Date(a.date)-new Date(b.date));
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
  const attendedBungs=[...attended].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const isMyProfile = currentUser && m.linkedUid === currentUser.uid;
  el.innerHTML=`
  <div style="margin-bottom:12px;display:flex;justify-content:space-between"><button class="btn btn-sm" onclick="backToProfileList()"><i class="ti ti-arrow-left"></i> 목록으로</button>
  ${isMyProfile?`<button class="btn btn-sm btn-primary" onclick="openEditMyProfile('${m.id}')"><i class="ti ti-edit"></i> 내 프로필 수정</button>`:''}</div>
  <div class="profile-card">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
      ${m.photoURL?`<img src="${m.photoURL}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;flex-shrink:0">`:`<div class="profile-avatar">${m.name[0]}</div>`}
      <div><div style="font-size:20px;font-weight:500">${m.name}</div>
      <div style="margin-top:4px"><span style="font-size:12px;padding:3px 10px;border-radius:20px;background:${grade.bg};color:${grade.color};font-weight:500">${grade.label}</span></div>
      ${m.memo?`<div style="font-size:12px;color:var(--text2);margin-top:6px">📝 ${m.memo}</div>`:''}
    </div></div>
    ${m.bio?`<div style="font-size:13px;line-height:1.7;background:var(--bg2);border-radius:var(--radius);padding:10px 12px;margin-bottom:12px">${m.bio}</div>`:''}
    ${(m.favSong||m.favArtist)?`<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text2);margin-bottom:12px">
      ${m.favArtist?`<span><i class="ti ti-microphone-2" style="color:var(--purple)"></i> 최애 아티스트: <strong style="color:var(--text)">${m.favArtist}</strong></span>`:''}
      ${m.favSong?`<span><i class="ti ti-music" style="color:var(--info)"></i> 최애곡: <strong style="color:var(--text)">${m.favSong}</strong></span>`:''}
    </div>`:''}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
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
      return `<div title="${formatDate(b.date)} ${b.name}${did?' · 참석':' · 불참'}" style="width:13px;height:13px;border-radius:3px;background:${did?'var(--info)':'var(--bg3)'}"></div>`;
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
          ${c.photoURL?`<img src="${c.photoURL}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`:`<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--purple-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500">${c.name[0]}</div>`}
          <div><div style="font-size:12px;font-weight:500">${c.name}</div><div style="font-size:11px;color:var(--text2)">${c.count}번 같이 참석</div></div>
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
    `<div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">
      <table><thead><tr><th>날짜</th><th>벙 이름</th><th>구분</th><th>장소</th></tr></thead><tbody>
      ${attendedBungs.slice(0,20).map(b=>`<tr>
        <td style="color:var(--text2)">${formatDate(b.date)}</td><td><strong>${b.name}</strong></td>
        <td>${b.type==='번개'?'<span class="badge badge-bungae">번개</span>':'<span class="badge badge-jeongmo">정모</span>'}</td>
        <td style="color:var(--text2)">${b.place||'-'}</td></tr>`).join('')}
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
      return `<div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg2);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px">
        <div><div style="font-size:13px;font-weight:500">🎶 ${t.title}</div><div style="font-size:11px;color:var(--text2);margin-top:2px">${roundLabel} 진행 중 · 후보 ${t.candidates.length}곡</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm btn-primary" onclick="openTournamentVote('${t.id}')">투표하기</button>
          ${isAdmin?`<button class="btn btn-sm" onclick="advanceTournamentRound('${t.id}')">다음 라운드</button>`:''}
        </div>
      </div>`;
    }).join('')}
    ${isAdmin?`<button class="btn btn-sm" onclick="openCreateTournament()"><i class="ti ti-plus"></i> 새 토너먼트 시작</button>`:''}
    ${done.length>0?`<div style="font-size:12px;font-weight:500;color:var(--text2);margin-top:14px;margin-bottom:6px">역대 우승곡</div>
    ${done.map(t=>`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:0.5px solid var(--border)">
      <span style="font-size:18px">🏆</span>
      <div style="flex:1"><div style="font-size:13px;font-weight:500">${t.winner?.songName||'-'}${t.winner?.artistName?` <span style="color:var(--text2);font-weight:400">- ${t.winner.artistName}</span>`:''}</div>
      <div style="font-size:11px;color:var(--text2)">${t.title}</div></div>
    </div>`).join('')}`:''}
  `;
}


function renderPlayground() {
  const el = document.getElementById('playground-content');
  if (!el) return;
  el.innerHTML = `<div class="hall-card"><h3>🎶 노래 이상형월드컵</h3>
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
  _tnPool = getUniqueSongPool();
  if (_tnPool.length<2) { alert('토너먼트를 시작하려면 추천곡이 2곡 이상 필요합니다. (플레이리스트 또는 노래 추천 게시판에 곡을 추가해주세요)'); return; }
  openModal(`<div class="modal-title">🎶 노래 이상형월드컵 시작</div>
    <input type="text" id="tn-title" placeholder="토너먼트 이름 (예: 2026년 6월 이상형월드컵)" style="width:100%;margin-bottom:10px">
    <div style="font-size:12px;color:var(--text2);margin-bottom:8px">참가곡을 선택하세요. 선택한 개수 중 2의 거듭수(최대 16곡)로 잘라 진행됩니다.</div>
    <div style="max-height:260px;overflow-y:auto;border:0.5px solid var(--border);border-radius:var(--radius);padding:8px;margin-bottom:14px">
      ${_tnPool.map((p,i)=>`<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;font-size:13px">
        <input type="checkbox" class="tn-song-check" value="${i}">
        <span>${p.songName}${p.artistName?` <span style="color:var(--text2)">- ${p.artistName}</span>`:''}</span>
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
    round0.push({a:{songName:selected[i].songName,artistName:selected[i].artistName||''}, b:{songName:selected[i+1].songName,artistName:selected[i+1].artistName||''}, votes:{}});
  }
  try {
    await addDoc(collection(db,'tournaments'), {
      title, candidates: selected.map(s=>({songName:s.songName,artistName:s.artistName||''})),
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
  const html = `<div class="modal-title">🎶 ${t.title} · ${roundLabel}</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
    ${round.map((match,mi)=>{
      const votesA = Object.values(match.votes||{}).filter(v=>v==='a').length;
      const votesB = Object.values(match.votes||{}).filter(v=>v==='b').length;
      const myVote = myUid ? (match.votes||{})[myUid] : null;
      return `<div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-sm" style="flex:1;text-align:left;${myVote==='a'?'background:var(--info-bg);border-color:var(--info)':''}" onclick="castTournamentVote('${t.id}',${mi},'a')">
            ${match.a.songName}${match.a.artistName?` <span style="color:var(--text2);font-size:11px">- ${match.a.artistName}</span>`:''}<br><span style="font-size:11px;color:var(--text2)">${votesA}표</span>
          </button>
          <span style="font-size:11px;color:var(--text2)">VS</span>
          <button class="btn btn-sm" style="flex:1;text-align:left;${myVote==='b'?'background:var(--info-bg);border-color:var(--info)':''}" onclick="castTournamentVote('${t.id}',${mi},'b')">
            ${match.b.songName}${match.b.artistName?` <span style="color:var(--text2);font-size:11px">- ${match.b.artistName}</span>`:''}<br><span style="font-size:11px;color:var(--text2)">${votesB}표</span>
          </button>
        </div>
      </div>`;
    }).join('')}
    </div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px">곡을 클릭해서 투표하세요. 다시 클릭하면 투표를 바꿀 수 있습니다.</div>
    <div class="flex" style="justify-content:flex-end"><button class="btn" onclick="closeTournamentVoteModal()">닫기</button></div>`;
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-backdrop').classList.add('open');
}

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
    <div style="font-size:13px;line-height:1.6;white-space:pre-line">${r.message}</div>
    <div class="flex-between" style="margin-top:6px">
      <div style="font-size:11px;color:var(--text2)">- ${r.anonymous?'익명':(r.fromName||'회원')}</div>
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
    fromUid: currentUser.uid, fromName: currentUser.displayName||currentUser.email,
    createdAt: serverTimestamp()
  });
  closeModal();
  loadRollingMessages(memberId);
};

window.deleteRollingMessage = async function(id, memberId) {
  if (!confirm('이 메시지를 삭제할까요?')) return;
  await deleteDoc(doc(db,'rollingMessages',id));
  loadRollingMessages(memberId);
};

const UPDATES=[
  {version:'v3.0.1',date:'2026.06.23',items:['[버그 수정] 노래 이상형월드컵 "시작" 버튼이 반응 없던 문제 수정 — Firestore가 지원하지 않는 중첩 배열 구조가 원인, 데이터 구조 변경 및 오류 발생 시 알림 표시 추가']},
  {version:'v3.0',date:'2026.06.23',items:['"놀이터" 탭 신설 — 노래 이상형월드컵을 명예의 전당에서 분리해 독립 탭으로 이동','"리포트" 탭을 "통계" 탭에 통합 (월별/분기별 리포트는 통계 화면 하단에서 확인)']},
  {version:'v2.9',date:'2026.06.23',items:['노래 이상형월드컵 추가 — 명예의 전당 탭에서 운영진이 추천곡으로 토너먼트 개설, 회원 투표로 라운드 진행, 우승곡은 역대 우승곡 명단에 영구 기록','롤링페이퍼 추가 — 회원 프로필에서 서로에게 메시지 남기기 (익명 가능), 본인/운영진만 삭제 가능']},
  {version:'v2.8',date:'2026.06.23',items:['프로필에 "출석 도장판" 추가 — 전체 벙을 도장 형태로 표시, 참석/불참 한눈에 확인','프로필에 "같이 가장 많이 만난 멤버" TOP3 카드 추가','벙 카드에 "회고" 버튼 추가 — 참석 인원, 첫 참석자, 오랜만에 복귀한 멤버, 단골 멤버 등을 자동 정리해 카카오톡 공유용 텍스트로 생성']},
  {version:'v2.7',date:'2026.06.23',items:['[버그 수정] 정산 계산기에서 금액 입력 시 한 글자만 쳐도 커서가 사라지던 문제 수정']},
  {version:'v2.6',date:'2026.06.18',items:['모임비 정산 계산기 추가 — 사이드바 "정산" 탭, 항목별 금액·참가인원 입력 시 자동 분담 계산','벙 선택 모드(참석자 자동 연동) / 직접 입력 모드 둘 다 지원, 벙 카드에서도 바로 정산 진입 가능','정산 내역은 정산 탭에 저장되어 나중에 다시 확인 가능, 오픈채팅 송금용 복사 텍스트 자동 생성']},
  {version:'v2.5',date:'2026.06.18',items:['게시판(자유게시판/건의사항) 글쓰기·수정 시 사진 최대 4장 첨부 가능','사진은 본문 원하는 위치에 삽입 가능 (커서 위치에 [이미지] 표시 자동 삽입, 자유롭게 이동 가능)']},
  {version:'v2.4',date:'2026.06.18',items:['가로 스크롤 버그 근본 원인 수정 (레이아웃 구조 문제) + 긴 글은 일정 글자 수 이후 "더보기"로 처리','공지사항 작성자명도 연동된 프로필 이름을 우선 사용하도록 수정']},
  {version:'v2.3',date:'2026.06.18',items:['회원에게 운영진/모임장 역할 부여 기능 추가 (회원 명단에서 지정, 동일 관리 권한)','오늘의 노래 추천 — 대시보드에 매일 자동 추천 (운영진 플레이리스트 + 노래 추천 게시판 추천곡 합산)','노래 추천 게시판 추가 — 곡명/아티스트/추천 이유 입력','게시판·공지·댓글에 긴 글(줄바꿈 없는 텍스트) 작성 시 페이지가 가로로 길게 늘어나던 버그 수정']},
  {version:'v2.2',date:'2026.06.18',items:['모바일/사파리 로그인 오류 수정 (팝업 우선 방식 + 실패 시 원인 표시)','로그인 없이 둘러보기(게스트 모드) 추가','구글 로그인 시 개인정보 수집·이용 안내 동의 절차 추가','회원 프로필 "목록으로" 버튼 작동 오류 수정','프로필 사진이 전체 회원 목록·이달의 MVP·이달의 벙주 카드에도 반영되도록 수정','운영진 계정도 회원 프로필 연동 가능하도록 수정 (즉시 연결), 회원 명단 탭에 "내 프로필 연결" 버튼 추가']},
  {version:'v2.1',date:'2026.06.18',items:['게시판 기능 추가 — 자유게시판, 건의사항(익명 가능), 댓글 기능','회원 프로필 ↔ 구글 계정 연결 시스템 (운영진 승인 방식)','프로필 커스텀 — 닉네임, 사진, 한줄소개, 최애곡/아티스트 (본인만 수정 가능)','통계 탭 기준을 최근 2개월 활동성으로 변경, 명예의 전당(전체 역대)과 역할 구분']},
  {version:'v2.0',date:'2026.06.17',items:['Firebase 전환 — 실시간 동기화, 회원별 Google 로그인','공지사항 탭 추가 — 작성/수정/삭제, 상단 고정, 중요 표시','운영진/일반 회원 권한 분리','Firebase Storage로 갤러리 전환']},
  {version:'v1.7',date:'2026.06.17',items:['캘린더 탭 추가','회원 프로필 탭 추가']},
  {version:'v1.6',date:'2026.06.17',items:['명예의 전당 강화 — 스트릭 랭킹, 벙주 랭킹, 월별 MVP']},
  {version:'v1.5',date:'2026.06.17',items:['대시보드 오른쪽 하단 — MVP, 신규 회원, 기념일, 업적 피드']},
  {version:'v1.4',date:'2026.06.16',items:['대시보드 리디자인, 업적 시스템, 사이드바 레이아웃']},
  {version:'v1.0',date:'2026.06.15',items:['최초 출시']},
];

function renderUpdates() {
  const el=document.getElementById('updates-content');
  if(!el)return;
  el.innerHTML=`<h3 style="margin-bottom:1rem">📋 패치 내역</h3>`+UPDATES.map(u=>`
    <div class="update-item"><div class="update-version">${u.version}</div><div class="update-date">${u.date}</div>
    <div style="font-size:13px;color:var(--text);line-height:1.8">${u.items.map(i=>`• ${i}`).join('<br>')}</div></div>`).join('');
}

// ── 공통 UI ───────────────────────────────────────────────────────
window.switchTab = function(tab) {
  document.querySelectorAll('.nav-item').forEach((t,i)=>t.classList.toggle('active',
    ['dashboard','notice','board','settlement','members','bung','ghost','stats','hall','playground','calendar','profile','gallery','updates'][i]===tab));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+tab).classList.add('active');
  if(tab==='gallery') loadGallery();
  if(tab==='calendar') renderCalendar();
  if(tab==='profile') renderProfileList();
  if(tab==='board') renderBoardList();
  if(tab==='settlement') renderSettlementList();
  if(tab==='playground') renderPlayground();
};

window.filterMembers = function(q) {
  document.querySelectorAll('#member-tbody tr').forEach(row=>{
    const name=row.querySelector('td strong')?.textContent||'';
    row.style.display=name.includes(q)?'':'none';
  });
};

window.filterProfileList = function(q) {
  document.querySelectorAll('#profile-list-grid > div').forEach(card=>{
    const name=card.querySelectorAll('div')[1]?.textContent||'';
    card.style.display=name.includes(q)?'':'none';
  });
};

window.openProfile = function(id) { selectedMemberId=id; renderMemberProfile(id); };
window.backToProfileList = function() { selectedMemberId=null; renderProfileList(); };
window.calNav = function(dir) {
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++;}
  if(calMonth<0){calMonth=11;calYear--;}
  renderCalendar();
};

window.showCalBungDetail = function(id) {
  const b=bungs.find(x=>x.id===id);if(!b)return;
  const host=b.hostId?members.find(x=>x.id===b.hostId):null;
  const names=(b.attendees||[]).map(id=>{const m=members.find(x=>x.id===id);return m?m.name:'?'});
  openModal(`<div class="modal-title">${b.name}</div>
    <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;margin-bottom:16px">
      <div class="flex"><i class="ti ti-calendar" style="color:var(--info)"></i>${formatDate(b.date)}</div>
      ${b.place?`<div class="flex"><i class="ti ti-map-pin" style="color:var(--danger)"></i>${b.place}</div>`:''}
      ${b.time?`<div class="flex"><i class="ti ti-clock" style="color:var(--success)"></i>${b.time}</div>`:''}
      ${host?`<div class="flex"><i class="ti ti-crown" style="color:var(--warn)"></i>${host.name}</div>`:''}
      <div class="flex"><i class="ti ti-users" style="color:var(--purple)"></i>${names.join(', ')||'없음'} (${names.length}명)</div>
    </div>
    <div class="flex" style="justify-content:flex-end"><button class="btn btn-primary" onclick="closeModal()">닫기</button></div>`);
};

// ── 모임비 정산 계산기 ───────────────────────────────────────────
let settlementItems = [];
let settlementMode = 'bung';
let settlementBungId = null;
let settlementManualNames = [];

function settlementParticipants() {
  if (settlementMode === 'bung') {
    const b = bungs.find(x => x.id === settlementBungId);
    if (!b) return [];
    return (b.attendees||[]).map(id => { const m = members.find(x=>x.id===id); return m ? {key:m.id, name:m.name} : null; }).filter(Boolean);
  }
  return settlementManualNames.map(n => ({key:n, name:n}));
}

window.openSettlement = function(bungId) {
  if (bungId) { switchTab('settlement'); }
  settlementItems = [];
  settlementMode = 'bung';
  settlementBungId = bungId || (bungs[0]?.id || null);
  settlementManualNames = [];
  renderSettlementModal();
};

function renderSettlementModal() {
  const pastBungs = [...bungs].sort((a,b)=>new Date(b.date)-new Date(a.date));
  openModal(`<div class="modal-title"><i class="ti ti-calculator" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>모임비 정산 계산기</div>
    <div class="flex" style="gap:8px;margin-bottom:12px">
      <button class="btn btn-sm ${settlementMode==='bung'?'btn-primary':''}" onclick="setSettlementMode('bung')">벙 선택</button>
      <button class="btn btn-sm ${settlementMode==='manual'?'btn-primary':''}" onclick="setSettlementMode('manual')">직접 입력</button>
    </div>
    <div id="settlement-source-area" style="margin-bottom:14px">
      ${settlementMode==='bung' ? `
        <select id="settlement-bung-select" onchange="onSettlementBungChange(this.value)">
          ${pastBungs.length===0?'<option value="">등록된 벙이 없습니다</option>':pastBungs.map(b=>`<option value="${b.id}" ${b.id===settlementBungId?'selected':''}>${formatDate(b.date)} · ${b.name}</option>`).join('')}
        </select>
        <div style="font-size:12px;color:var(--text2);margin-top:6px">참석자: ${settlementParticipants().map(p=>p.name).join(', ')||'없음'}</div>
      ` : `
        <div class="flex" style="gap:8px;margin-bottom:6px">
          <input type="text" id="settlement-name-input" placeholder="이름 입력 후 엔터" style="flex:1" onkeydown="if(event.key==='Enter'){event.preventDefault();addSettlementManualName();}">
          <button class="btn btn-sm" type="button" onclick="addSettlementManualName()">추가</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="settlement-name-tags">${settlementManualNames.map(n=>`<span class="attendee-tag">${n} <span style="cursor:pointer;margin-left:2px" onclick="removeSettlementManualName('${n}')">×</span></span>`).join('')||'<span style="font-size:12px;color:var(--text2)">참가자를 입력해주세요</span>'}</div>
      `}
    </div>
    <div style="font-size:13px;font-weight:500;margin-bottom:8px">정산 항목</div>
    <div id="settlement-items-area" style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px"></div>
    <button class="btn btn-sm" style="margin-bottom:16px" onclick="addSettlementItem()"><i class="ti ti-plus"></i> 항목 추가</button>
    <div id="settlement-result-area"></div>
    <div class="flex" style="justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn" onclick="closeModal()">닫기</button><button class="btn btn-primary" onclick="saveSettlement()"><i class="ti ti-device-floppy"></i> 저장</button></div>`);
  if (settlementItems.length === 0) addSettlementItem();
  else renderSettlementItems();
}

window.setSettlementMode = function(mode) {
  settlementMode = mode;
  renderSettlementModal();
};

window.onSettlementBungChange = function(id) {
  settlementBungId = id;
  renderSettlementModal();
};

window.addSettlementManualName = function() {
  const input = document.getElementById('settlement-name-input');
  const name = input.value.trim();
  if (!name || settlementManualNames.includes(name)) { input.value=''; return; }
  settlementManualNames.push(name);
  input.value = '';
  renderSettlementModal();
  // 모달 전체를 다시 그리면서 input이 새로 생성되어 포커스가 풀리므로, 다시 포커스를 줌
  const newInput = document.getElementById('settlement-name-input');
  if (newInput) newInput.focus();
};

window.removeSettlementManualName = function(name) {
  settlementManualNames = settlementManualNames.filter(n => n !== name);
  settlementItems.forEach(it => { it.participants = it.participants.filter(k => k !== name); });
  renderSettlementModal();
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

window.updateSettlementItemField = function(id, field, value) {
  const it = settlementItems.find(x => x.id === id);
  if (!it) return;
  it[field] = field === 'amount' ? (parseInt(String(value).replace(/[^0-9]/g,''))||0) : value;
  if (field === 'amount') {
    // 입력칸을 통째로 다시 그리면 커서가 사라지므로, 1인당 금액 표시만 갱신
    const perEl = document.getElementById('settlement-per-'+id);
    if (perEl) {
      const perPerson = it.participants.length > 0 ? Math.round(it.amount / it.participants.length) : 0;
      perEl.textContent = `${it.participants.length}명 참여 · 1인당 ${perPerson.toLocaleString()}원`;
    }
    renderSettlementResult();
  } else {
    renderSettlementResult();
  }
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

function renderSettlementItems() {
  const area = document.getElementById('settlement-items-area');
  if (!area) return;
  const participants = settlementParticipants();
  area.innerHTML = settlementItems.map(it => {
    const perPerson = it.participants.length > 0 ? Math.round(it.amount / it.participants.length) : 0;
    return `<div style="border:0.5px solid var(--border);border-radius:var(--radius);padding:12px">
      <div class="flex" style="gap:8px;margin-bottom:10px">
        <input type="text" placeholder="항목명 (예: 식사)" value="${it.name}" style="flex:1" oninput="updateSettlementItemField('${it.id}','name',this.value)">
        <input type="text" placeholder="금액" value="${it.amount?it.amount.toLocaleString():''}" style="width:110px;text-align:right" oninput="updateSettlementItemField('${it.id}','amount',this.value)" onblur="formatSettlementAmountInput('${it.id}',this)">
        <span style="display:flex;align-items:center;font-size:13px;color:var(--text2)">원</span>
        <button class="btn btn-sm btn-danger" onclick="removeSettlementItem('${it.id}')"><i class="ti ti-trash"></i></button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${participants.length===0?'<span style="font-size:12px;color:var(--text2)">참가자가 없습니다</span>':participants.map(p=>{
          const checked = it.participants.includes(p.key);
          return `<label style="display:flex;align-items:center;gap:4px;font-size:13px;border:0.5px solid var(--border);border-radius:var(--radius);padding:4px 10px;cursor:pointer;${checked?'background:var(--bg2)':'color:var(--text3)'}"><input type="checkbox" ${checked?'checked':''} style="margin:0" onchange="toggleSettlementParticipant('${it.id}','${p.key}')">${p.name}</label>`;
        }).join('')}
      </div>
      <div id="settlement-per-${it.id}" style="font-size:12px;color:var(--text2);margin-top:8px">${it.participants.length}명 참여 · 1인당 ${perPerson.toLocaleString()}원</div>
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
    if (!it.amount || it.participants.length === 0) return;
    const per = Math.round(it.amount / it.participants.length);
    grandTotal += it.amount;
    it.participants.forEach(key => { if (totals[key] !== undefined) totals[key] += per; });
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
        <div style="font-size:12px;color:var(--text2)">${p.name}</div>
        <div style="font-size:18px;font-weight:500">${(totals[p.key]||0).toLocaleString()}원</div>
      </div>`).join('')}
    </div>
    <div style="font-size:12px;color:var(--text3)">총 지출 ${grandTotal.toLocaleString()}원 · 분담 합계 ${sumCheck.toLocaleString()}원</div>
    <div style="margin-top:12px">
      <div class="flex-between" style="margin-bottom:6px"><span style="font-size:13px;font-weight:500">오픈채팅 정산 요청 텍스트</span><button class="btn btn-sm" onclick="copySettlementText()"><i class="ti ti-copy"></i> 복사</button></div>
      <div class="template-box" id="settlement-text">${buildSettlementText()}</div>
    </div>`;
}

function buildSettlementText() {
  const b = settlementMode === 'bung' ? bungs.find(x=>x.id===settlementBungId) : null;
  const title = b ? `${formatDate(b.date)} ${b.name} 정산 안내` : '모임비 정산 안내';
  const { totals, participants } = computeSettlementTotals();
  const itemLines = settlementItems.filter(it=>it.amount && it.participants.length>0).map(it => {
    const names = it.participants.map(k => participants.find(p=>p.key===k)?.name || k).join(', ');
    const per = Math.round(it.amount / it.participants.length);
    return `${it.name||'항목'} ${it.amount.toLocaleString()}원 ÷ ${it.participants.length}명 = ${per.toLocaleString()}원 (${names})`;
  }).join('\n');
  const personLines = participants.map(p => `▸ ${p.name}: ${(totals[p.key]||0).toLocaleString()}원`).join('\n');
  return `${title}\n\n${itemLines}\n\n${personLines}\n\n오픈채팅 송금으로 보내주세요!`;
}

window.copySettlementText = function() {
  const text = document.getElementById('settlement-text').innerText;
  navigator.clipboard.writeText(text).then(()=>{
    const btn = event.target.closest('button');
    btn.innerHTML = '<i class="ti ti-check"></i> 복사됨!';
    setTimeout(()=>{ btn.innerHTML = '<i class="ti ti-copy"></i> 복사'; }, 2000);
  });
};

window.saveSettlement = async function() {
  const validItems = settlementItems.filter(it => it.name && it.amount && it.participants.length>0);
  if (validItems.length === 0) { alert('정산 항목을 1개 이상 입력해주세요.'); return; }
  const { totals, grandTotal, participants } = computeSettlementTotals();
  const data = {
    mode: settlementMode,
    bungId: settlementMode==='bung' ? settlementBungId : null,
    title: settlementMode==='bung' ? (bungs.find(x=>x.id===settlementBungId)?.name||'정산') : '직접 입력 정산',
    date: settlementMode==='bung' ? (bungs.find(x=>x.id===settlementBungId)?.date||TODAY.toISOString().slice(0,10)) : TODAY.toISOString().slice(0,10),
    items: validItems.map(it=>({name:it.name, amount:it.amount, participants:it.participants})),
    participants: participants,
    totals,
    grandTotal,
    text: buildSettlementText(),
    createdAt: serverTimestamp()
  };
  const ref = await addDoc(collection(db, 'settlements'), data);
  if (settlementMode === 'bung' && settlementBungId) {
    await updateDoc(doc(db, 'bungs', settlementBungId), { settlement: { settlementId: ref.id, grandTotal } });
  }
  closeModal();
};

function renderSettlementList() {
  const el = document.getElementById('settlement-list');
  if (!el) return;
  getDocs(query(collection(db,'settlements'), orderBy('createdAt','desc'))).then(snap => {
    const items = snap.docs.map(d => ({id:d.id, ...d.data()}));
    if (items.length === 0) { el.innerHTML = '<div class="empty-state"><i class="ti ti-calculator"></i>정산 내역이 없습니다.</div>'; return; }
    el.innerHTML = items.map(s => `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem 1.25rem;margin-bottom:10px">
      <div class="flex-between mb-1">
        <div class="flex"><strong>${s.title}</strong><span style="font-size:12px;color:var(--text2)">${formatDate(s.date)}</span></div>
        <div class="flex" style="gap:4px">
          <button class="btn btn-sm" onclick="viewSettlement('${s.id}')"><i class="ti ti-eye"></i> 보기</button>
          <button class="btn btn-sm btn-danger edit-only" onclick="deleteSettlement('${s.id}','${s.bungId||''}')"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text2)">총 ${(s.grandTotal||0).toLocaleString()}원 · ${(s.participants||[]).map(p=>p.name).join(', ')}</div>
    </div>`).join('');
  });
}

window.viewSettlement = async function(id) {
  const snap = await getDoc(doc(db,'settlements',id));
  if (!snap.exists()) return;
  const s = snap.data();
  openModal(`<div class="modal-title"><i class="ti ti-receipt-2" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>${s.title}</div>
    <div class="template-box" style="margin-bottom:16px">${s.text}</div>
    <div class="flex" style="justify-content:flex-end;gap:8px">
      <button class="btn" onclick="closeModal()">닫기</button>
      <button class="btn btn-primary" onclick="copyViewedSettlement(this)" data-text="${encodeURIComponent(s.text)}"><i class="ti ti-copy"></i> 복사</button>
    </div>`);
};

window.copyViewedSettlement = function(btn) {
  const text = decodeURIComponent(btn.getAttribute('data-text'));
  navigator.clipboard.writeText(text).then(()=>{
    btn.innerHTML = '<i class="ti ti-check"></i> 복사됨!';
    setTimeout(()=>{ btn.innerHTML = '<i class="ti ti-copy"></i> 복사'; }, 2000);
  });
};

window.deleteSettlement = async function(id, bungId) {
  if (!confirm('이 정산 내역을 삭제할까요?')) return;
  await deleteDoc(doc(db,'settlements',id));
  if (bungId) await updateDoc(doc(db,'bungs',bungId), { settlement: null });
  renderSettlementList();
};

window.openTemplate = function(id) {
  const b=bungs.find(x=>x.id===id);if(!b)return;
  const host=b.hostId?members.find(x=>x.id===b.hostId):null;
  const d=new Date(b.date);
  const weekdays=['일','월','화','수','목','금','토'];
  const dateStr=`${d.getMonth()+1}월 ${d.getDate()}일(${weekdays[d.getDay()]})`;
  const template=`일시 : ${dateStr}\n장소 : ${b.place||'미정'}\n시간 : ${b.time||'미정'}\n인원 : ${(b.attendees||[]).length}명\n주제 : ${b.topic||'노래방'}${b.memo?`\n\n${b.memo}`:''}`;
  openModal(`<div class="modal-title"><i class="ti ti-speakerphone" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>벙 공지 템플릿</div>
    <div class="template-box" id="template-text">${template}</div>
    <div class="alert alert-info" style="margin-bottom:12px"><i class="ti ti-info-circle"></i>복사 후 카카오톡에 붙여넣으세요.</div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">닫기</button>
    <button class="btn btn-primary" onclick="copyTemplate()"><i class="ti ti-copy"></i> 복사</button></div>`);
};

window.copyTemplate = function() {
  const text=document.getElementById('template-text').innerText;
  navigator.clipboard.writeText(text).then(()=>{
    const btn=event.target.closest('button');
    btn.innerHTML='<i class="ti ti-check"></i> 복사됨!';
    setTimeout(()=>{btn.innerHTML='<i class="ti ti-copy"></i> 복사';},2000);
  });
};

window.openBungRecap = function(id) {
  const b = bungs.find(x=>x.id===id); if(!b) return;
  const allSorted = [...bungs].sort((a,c)=>new Date(a.date)-new Date(c.date));
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
    <div class="template-box" id="recap-text" style="white-space:pre-line">${recapText}</div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">닫기</button>
    <button class="btn btn-primary" onclick="copyRecapText()"><i class="ti ti-copy"></i> 복사</button></div>`);
};

window.copyRecapText = function() {
  const text=document.getElementById('recap-text').innerText;
  navigator.clipboard.writeText(text).then(()=>{
    const btn=event.target.closest('button');
    btn.innerHTML='<i class="ti ti-check"></i> 복사됨!';
    setTimeout(()=>{btn.innerHTML='<i class="ti ti-copy"></i> 복사';},2000);
  });
};

window.openGhostMessage = function() {
  const cd=getCalcDate();
  const ghosts=members.filter(m=>getMemberStatus(m,cd)==='ghost');
  if(ghosts.length===0){openModal(`<div class="modal-title">퇴출 메시지</div><div class="alert alert-success"><i class="ti ti-check"></i>퇴출 대상자가 없습니다.</div><div class="flex" style="justify-content:flex-end"><button class="btn btn-primary" onclick="closeModal()">확인</button></div>`);return;}
  const nameList=ghosts.map(m=>`• ${m.name}`).join('\n');
  const msg=`안녕하세요! KIKU 운영진입니다 🎤\n\n${formatDate(cd)} 기준 유령 회원 정리를 진행합니다.\n\n아래 회원분들은 최근 2개월간 벙 참여 기록이 없어 퇴출 예정입니다.\n\n${nameList}\n\n계속 활동을 원하시는 분은 운영진에게 연락 주세요!\n연락 없으실 경우 자동 퇴출 처리됩니다. 🙏`;
  openModal(`<div class="modal-title">퇴출 메시지</div>
    <div class="template-box" id="ghost-msg-text">${msg}</div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">닫기</button>
    <button class="btn btn-primary" onclick="copyGhostMsg()"><i class="ti ti-copy"></i> 복사</button></div>`);
};

window.copyGhostMsg = function() {
  const text=document.getElementById('ghost-msg-text').innerText;
  navigator.clipboard.writeText(text).then(()=>{
    const btn=event.target.closest('button');
    btn.innerHTML='<i class="ti ti-check"></i> 복사됨!';
    setTimeout(()=>{btn.innerHTML='<i class="ti ti-copy"></i> 복사';},2000);
  });
};

window.confirmReset = function() {
  openModal(`<div class="modal-title" style="color:var(--danger)"><i class="ti ti-alert-triangle" style="font-size:17px;vertical-align:-3px;margin-right:4px"></i>초기화 확인</div>
    <div class="alert alert-danger" style="margin-bottom:12px">모든 회원의 <strong>운영진 연락 여부</strong>를 초기화합니다.</div>
    <div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn" onclick="closeModal()">취소</button><button class="btn btn-danger" onclick="doReset()">초기화 실행</button></div>`);
};

window.doReset = async function() {
  for(const m of members) await updateDoc(doc(db,'members',m.id),{contacted:false});
  closeModal();
};

window.handleAttendeeInput = function(e,mode){if(e.key==='Enter'||e.key===','){e.preventDefault();handleAttendeeAdd(mode);}};
window.handleAttendeeAdd = function(mode){
  const inputId=mode==='add'?'member-search':'member-search-edit';
  const input=document.getElementById(inputId);if(!input)return;
  const names=input.value.split(/[,،]/).map(n=>n.trim()).filter(Boolean);
  names.forEach(name=>{const m=members.find(x=>x.name===name);if(m)addAttendeeTag(m.id,m.name,mode);});
  input.value='';updateHostSelect(mode);
};

window.addAttendeeTag = function(id,name,mode){
  const tagArea=document.getElementById(`${mode}-tag-area`);
  const list=document.getElementById(`${mode}-attendee-list`);
  if(!tagArea||tagArea.querySelector(`[data-id="${id}"]`))return;
  const tag=document.createElement('span');
  tag.className='attendee-tag';tag.setAttribute('data-id',id);
  tag.innerHTML=`${name} <span style="cursor:pointer;margin-left:2px" onclick="removeAttendeeTag(this,'${mode}')">×</span>`;
  tagArea.appendChild(tag);
  if(list){const cb=list.querySelector(`.attend-check[value="${id}"]`);if(cb)cb.checked=true;}
  updateHostSelect(mode);
};

window.removeAttendeeTag = function(el,mode){
  const tag=el.parentElement;const id=tag.getAttribute('data-id');
  const list=document.getElementById(`${mode}-attendee-list`);
  tag.remove();
  if(list){const cb=list.querySelector(`.attend-check[value="${id}"]`);if(cb)cb.checked=false;}
  updateHostSelect(mode);
};

window.toggleAttendeeTag = function(label,mode){
  const id=label.getAttribute('data-id'),name=label.getAttribute('data-name');
  const cb=label.querySelector('.attend-check');
  const tagArea=document.getElementById(`${mode}-tag-area`);if(!tagArea)return;
  if(cb.checked){const tag=tagArea.querySelector(`[data-id="${id}"]`);if(tag)tag.remove();cb.checked=false;}
  else addAttendeeTag(id,name,mode);
  updateHostSelect(mode);
};

window.updateHostSelect = function(mode){
  const prefix=mode==='add'?'b':'eb';
  const hostSel=document.getElementById(`${prefix}-host`);
  if(!hostSel)return;
  const tagArea=document.getElementById(`${mode}-tag-area`);if(!tagArea)return;
  const tags=[...tagArea.querySelectorAll('.attendee-tag')];
  const currentVal=hostSel.value;
  hostSel.innerHTML='<option value="">선택 안 함</option>'+tags.map(tag=>{
    const id=tag.getAttribute('data-id');
    const m=members.find(x=>x.id===id);
    return m?`<option value="${m.id}" ${currentVal===m.id?'selected':''}>${m.name}</option>`:'';
  }).join('');
};

function updateEditMode(){
  document.querySelectorAll('.edit-only').forEach(el=>el.style.display=isAdmin?'':'none');
}

function openModal(html){document.getElementById('modal-content').innerHTML=html;document.getElementById('modal-backdrop').classList.add('open');}
window.closeModal = function(){document.getElementById('modal-backdrop').classList.remove('open');};
// 텍스트 드래그 중 마우스가 배경으로 나가서 click이 발생해도 닫히지 않도록,
// mousedown이 배경 자체에서 "시작"된 경우에만 닫히도록 처리 (드래그 시작점이 모달 내부면 무시)
let modalMouseDownOnBackdrop = false;
document.getElementById('modal-backdrop').addEventListener('mousedown',function(e){modalMouseDownOnBackdrop = (e.target===this);});
document.getElementById('modal-backdrop').addEventListener('click',function(e){if(e.target===this && modalMouseDownOnBackdrop)closeModal();modalMouseDownOnBackdrop=false;});

window.toggleTheme = function(){
  const root=document.documentElement;
  const next=root.getAttribute('data-theme')==='dark'?'light':'dark';
  root.setAttribute('data-theme',next);
  localStorage.setItem('kiku-theme',next);
  document.getElementById('theme-icon').className=next==='dark'?'ti ti-sun':'ti ti-moon';
};

function initTheme(){
  const saved=localStorage.getItem('kiku-theme');
  const prefersDark=window.matchMedia('(prefers-color-scheme:dark)').matches;
  const theme=saved||(prefersDark?'dark':'light');
  document.documentElement.setAttribute('data-theme',theme);
  const icon=document.getElementById('theme-icon');
  if(icon)icon.className=theme==='dark'?'ti ti-sun':'ti ti-moon';
}
