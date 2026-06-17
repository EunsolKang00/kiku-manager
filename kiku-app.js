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
let members = [], bungs = [], notices = [];
let nextMemberId = 1, nextBungId = 1;
let calYear = TODAY.getFullYear(), calMonth = TODAY.getMonth();
let selectedMemberId = null;
let unsubscribers = [];

window.signInWithGoogle = async function() {
  document.getElementById('login-status').textContent = '로그인 중...';
  try {
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if (isMobile) { await signInWithRedirect(auth, provider); }
    else { await signInWithPopup(auth, provider); }
  } catch(e) {
    document.getElementById('login-status').textContent = '로그인 실패: ' + e.message;
  }
};

window.signOut = async function() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  await fbSignOut(auth);
};

onAuthStateChanged(auth, async user => {
  await getRedirectResult(auth).catch(() => {});
  if (user) {
    currentUser = user;
    isAdmin = ADMIN_EMAILS.includes(user.email);
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('sidebar-user').innerHTML = `<i class="ti ti-user" style="font-size:12px"></i>${user.displayName||user.email}${isAdmin?'<span style="font-size:10px;background:var(--warn-bg);color:var(--warn);padding:1px 5px;border-radius:3px;margin-left:4px">운영진</span>':''}`;
    updateEditMode();
    initTheme();
    await loadData();
  } else {
    currentUser = null;
    isAdmin = false;
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  }
});

async function loadData() {
  setSyncStatus('loading', '데이터 불러오는 중...');
  try {
    const memberUnsub = onSnapshot(collection(db, 'members'), snap => {
      members = snap.docs.map(d => ({id: d.id, ...d.data()}));
      nextMemberId = members.length > 0 ? Math.max(...members.map(m => parseInt(m.numId)||0)) + 1 : 1;
      renderAll();
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
    unsubscribers = [memberUnsub, bungUnsub, noticeUnsub];
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
    <div style="font-size:13px;line-height:1.8;white-space:pre-wrap;margin-bottom:16px">${n.content}</div>
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
    authorName: currentUser.displayName || currentUser.email,
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
  });
  for (const id of attendees) {
    const m = members.find(x => x.id === id);
    if (m) {
      const cur = m.lastAttend ? new Date(m.lastAttend) : null;
      const d = new Date(date);
      if (!cur || d > cur) await updateDoc(doc(db, 'members', id), {lastAttend: date});
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
    if (newLast !== m.lastAttend) await updateDoc(doc(db, 'members', m.id), {lastAttend: newLast});
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
  return [
    {id:'first', icon:'🎤', label:'첫 발걸음', desc:'첫 벙 참석', unlocked:attended.length>=1},
    {id:'streak3', icon:'🔥', label:'3연속 개근', desc:'3번 연속 참석', unlocked:maxStreak>=3},
    {id:'host', icon:'👑', label:'벙주 데뷔', desc:'첫 벙주 담당', unlocked:hostedBungs.length>=1},
    {id:'attend10', icon:'🎯', label:'10회 참석', desc:'총 10회 참석', unlocked:attended.length>=10},
    {id:'master', icon:'💎', label:'개근왕', desc:'참여율 80% 이상', unlocked:rate>=80},
    {id:'anniv', icon:'🌟', label:'1주년 멤버', desc:'가입 1년 이상', unlocked:yearsDiff>=1},
    {id:'jeongmo5', icon:'🏆', label:'정모 마스터', desc:'정모 5회 이상 참석', unlocked:jeongmoAttended.length>=5},
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

// ── 렌더링 ────────────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderDashboardAlerts();
  renderDashboardAchievements();
  renderMembers();
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
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--warn-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:500;flex-shrink:0">${mvp.name[0]}</div>
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
    return `<tr${rc}><td><strong>${m.name}</strong></td><td>${formatDate(m.joinDate)}</td><td>${m.lastAttend?formatDate(m.lastAttend):'<span style="color:var(--text2)">없음</span>'}</td><td style="text-align:center"><input type="checkbox" class="contact-check" ${m.contacted?'checked':''} onchange="toggleContact('${m.id}',this.checked)" ${isAdmin?'':' disabled'}></td><td>${badgeMap[status]}</td><td>${gradeBadge}</td><td>${memo}</td><td class="edit-only"><div class="flex" style="gap:4px"><button class="btn btn-sm" onclick="openEditMember('${m.id}')"><i class="ti ti-edit"></i></button><button class="btn btn-sm btn-danger" onclick="deleteMember('${m.id}')"><i class="ti ti-trash"></i></button></div></td></tr>`;
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
    return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:1rem 1.25rem;margin-bottom:10px">
      <div class="flex-between mb-1">
        <div class="flex">${typeBadge}<strong>${b.name}</strong>${isPast?'<span class="badge badge-safe">완료</span>':'<span class="badge badge-new">예정</span>'}</div>
        <div class="flex" style="gap:4px">
          <button class="btn btn-sm btn-info" onclick="openTemplate('${b.id}')"><i class="ti ti-speakerphone"></i> 공지</button>
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
  const totalBungs = bungs.length;
  const stats = getMemberStats();
  if (totalBungs===0||members.length===0) { el.innerHTML='<div class="empty-state"><i class="ti ti-chart-bar"></i>벙과 회원 데이터가 있어야 통계를 볼 수 있어요.</div>'; return; }
  const top3 = stats.slice(0,3);
  const medals = ['🥇','🥈','🥉'];
  const gradeCount = {우수:stats.filter(s=>s.rate>=60).length, 활동:stats.filter(s=>s.rate>=20&&s.rate<60).length, 일반:stats.filter(s=>s.rate<20).length};
  el.innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:1.5rem">
    <div class="metric"><div class="metric-label">총 벙 횟수</div><div class="metric-value">${totalBungs}회</div></div>
    <div class="metric"><div class="metric-label">⭐ 우수</div><div class="metric-value" style="color:var(--success)">${gradeCount.우수}명</div></div>
    <div class="metric"><div class="metric-label">✅ 활동</div><div class="metric-value" style="color:var(--info)">${gradeCount.활동}명</div></div>
    <div class="metric"><div class="metric-label">👤 일반</div><div class="metric-value" style="color:var(--text2)">${gradeCount.일반}명</div></div>
  </div>
  <div style="margin-bottom:1.5rem"><h3>🏆 참여율 랭킹 TOP 3</h3>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${top3.map((s,i)=>`<div style="display:flex;align-items:center;gap:12px;background:var(--bg2);border-radius:var(--radius-lg);padding:10px 16px">
        <span style="font-size:20px">${medals[i]}</span>
        <div style="flex:1"><div style="font-weight:500">${s.name} <span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:${s.grade.bg};color:${s.grade.color};font-weight:500">${s.grade.label}</span></div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${s.attended}회 / 전체 ${totalBungs}회</div></div>
        <div style="font-size:20px;font-weight:500;color:${s.grade.color}">${s.rate}%</div>
      </div>`).join('')}
    </div>
  </div>
  <div><h3>전체 회원 참여율</h3>
    <div style="border:0.5px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">
      <table><thead><tr><th>순위</th><th>이름</th><th>등급</th><th>참석</th><th>참여율</th><th>그래프</th></tr></thead><tbody>
      ${stats.map((s,i)=>`<tr><td style="color:var(--text2)">${i+1}</td><td><strong>${s.name}</strong></td>
        <td><span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:${s.grade.bg};color:${s.grade.color};font-weight:500">${s.grade.label}</span></td>
        <td>${s.attended}회</td><td style="font-weight:500;color:${s.grade.color}">${s.rate}%</td>
        <td style="min-width:80px"><div style="background:var(--bg3);border-radius:4px;height:8px;overflow:hidden"><div style="width:${s.rate}%;background:${s.grade.color};height:100%;border-radius:4px"></div></div></td>
      </tr>`).join('')}
      </tbody></table>
    </div>
    <div style="font-size:12px;color:var(--text2);margin-top:8px">등급 기준: ⭐ 우수 60% 이상 | ✅ 활동 20~59% | 👤 일반 20% 미만</div>
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
      <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--warn-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:500">${topHost.name[0]}</div>
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
  <div class="hall-card"><h3>🏅 개인 업적 현황</h3>
    ${members.length===0?'<div style="font-size:13px;color:var(--text2)">회원 데이터가 없습니다.</div>':
    '<div style="display:flex;flex-direction:column;gap:4px">'+
    members.map(m=>{const achvs=getAchievements(m);const unlocked=achvs.filter(a=>a.unlocked);if(unlocked.length===0)return '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border)">
        <div style="font-size:13px;font-weight:500;min-width:60px">${m.name}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;flex:1">${achvs.map(a=>`<span title="${a.label}" style="font-size:17px;${a.unlocked?'':'opacity:0.2;filter:grayscale(1)'}">${a.icon}</span>`).join('')}</div>
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
        <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--purple-bg),var(--info-bg));display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:500;margin-bottom:8px">${m.name[0]}</div>
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
  el.innerHTML=`
  <div style="margin-bottom:12px"><button class="btn btn-sm" onclick="selectedMemberId=null;renderProfileList()"><i class="ti ti-arrow-left"></i> 목록으로</button></div>
  <div class="profile-card">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
      <div class="profile-avatar">${m.name[0]}</div>
      <div><div style="font-size:20px;font-weight:500">${m.name}</div>
      <div style="margin-top:4px"><span style="font-size:12px;padding:3px 10px;border-radius:20px;background:${grade.bg};color:${grade.color};font-weight:500">${grade.label}</span></div>
      ${m.memo?`<div style="font-size:12px;color:var(--text2);margin-top:6px">📝 ${m.memo}</div>`:''}
    </div></div>
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
    <div style="font-size:13px;font-weight:500;margin-bottom:10px">업적 (${unlocked.length}/${achvs.length})</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${achvs.map(a=>`<div style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:var(--radius);background:${a.unlocked?'var(--warn-bg)':'var(--bg2)'};border:0.5px solid ${a.unlocked?'var(--warn-border)':'var(--border)'};${a.unlocked?'':'opacity:0.5'}">
        <span style="font-size:18px">${a.icon}</span>
        <div><div style="font-size:12px;font-weight:500;color:${a.unlocked?'var(--warn)':'var(--text2)'}">${a.label}</div><div style="font-size:11px;color:var(--text2)">${a.desc}</div></div>
      </div>`).join('')}
    </div>
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
  </div>`;
}

const UPDATES=[
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
    ['dashboard','notice','members','bung','ghost','stats','report','hall','calendar','profile','gallery','updates'][i]===tab));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+tab).classList.add('active');
  if(tab==='gallery') loadGallery();
  if(tab==='calendar') renderCalendar();
  if(tab==='profile') renderProfileList();
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
document.getElementById('modal-backdrop').addEventListener('click',function(e){if(e.target===this)closeModal();});

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
