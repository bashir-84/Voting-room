const SUPABASE_URL = 'https://wmtonpilbyxcbhmiafzj.supabase.co';
const KEY = 'sb_publishable_BxrMGHnc3oCfME-WUJQxcw_PqUlXZgq';
const db = supabase.createClient(SUPABASE_URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = id => document.getElementById(id);
let roomId = sessionStorage.getItem('voting_room_id');
let current = null;
let busy = false;
let pollId;
let previousStatus = '';

function notice(message, error = false) {
  const box = $('notice'); box.hidden = !message; box.textContent = message;
  box.classList.toggle('error', error);
}
function messageFor(error) {
  const raw = error?.message || String(error);
  if (/Failed to fetch|NetworkError|fetch failed/i.test(raw)) return 'ارتباط با سرور برقرار نشد. اینترنت یا دسترسی به Supabase را بررسی کنید.';
  if (/duplicate key|unique constraint/i.test(raw)) return 'رأی شما قبلاً ثبت شده یا کد اتاق تکراری شده است.';
  return raw;
}
async function action(work) {
  if (busy) return; busy = true; notice('');
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await work(); } catch (e) { notice(messageFor(e), true); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
async function ensureGuest() {
  const { data: existing, error: getError } = await db.auth.getSession();
  if (getError) throw getError;
  if (existing.session) return;
  const { error } = await db.auth.signInAnonymously();
  if (error) throw error;
}
async function call(name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
function enter(id) {
  roomId = id; sessionStorage.setItem('voting_room_id', id);
  $('home').hidden = true; $('room').hidden = false;
  if (!pollId) pollId = setInterval(() => { if (!busy && roomId) refresh().catch(e => notice(messageFor(e), true)); }, 2500);
  return refresh();
}
async function refresh() {
  const requested = roomId;
  const data = await call('get_voting_room', { p_room_id: requested });
  if (requested !== roomId) return;
  current = data;
  render(data);
  if (previousStatus && previousStatus !== data.status) notice(data.status === 'finished' ? 'رأی‌گیری تمام شد و نتیجه آماده است.' : 'رأی‌گیری شروع شد.');
  previousStatus = data.status;
}
function render(data) {
  const { players, status, votes } = data;
  $('room-code').textContent = data.code;
  $('status').textContent = { waiting: 'در انتظار شروع', voting: 'رأی‌گیری در جریان است', finished: 'پایان یافته' }[status];
  $('progress').textContent = status === 'waiting' ? `${players.length} نفر` : `${data.vote_count} از ${players.length} رأی`;
  $('players').replaceChildren(...players.map(p => {
    const row = document.createElement('div'); row.className = 'person';
    const name = document.createElement('span'); name.textContent = p.name;
    const mark = document.createElement('small'); mark.textContent = p.id === data.my_player_id ? 'شما' : '';
    row.append(name, mark); return row;
  }));
  $('waiting').hidden = status !== 'waiting'; $('voting').hidden = status !== 'voting'; $('finished').hidden = status !== 'finished';
  $('start').hidden = !data.is_host;
  $('waiting-text').textContent = data.is_host ? 'کد یا لینک اتاق را به دوستانت بده؛ با حضور دست‌کم دو نفر بازی را شروع کن.' : 'منتظر بمان تا میزبان رأی‌گیری را شروع کند.';
  $('finish').hidden = !data.is_host;
  const voted = sessionStorage.getItem(`voted_${data.room_id}`) === 'yes';
  $('my-vote').hidden = !voted;
  $('choices').replaceChildren(...(voted ? [] : players.map(p => {
    const button = document.createElement('button'); button.className = 'choice'; button.textContent = p.name;
    button.addEventListener('click', () => {
      if (!confirm(`رأی به «${p.name}» ثبت شود؟ امکان تغییر آن نیست.`)) return;
      action(async () => {
        await call('cast_voting_vote', { p_room_id: roomId, p_target_id: p.id });
        sessionStorage.setItem(`voted_${roomId}`, 'yes'); await refresh();
      });
    }); return button;
  })));
  if (status === 'finished') {
    const list = [...players].map(p => ({ player: p, supporters: (votes || []).filter(v => v.target_id === p.id).map(v => v.voter_name) }));
    list.sort((a, b) => b.supporters.length - a.supporters.length);
    $('results').replaceChildren(...list.map(item => {
      const row = document.createElement('div'); row.className = 'result';
      const line = document.createElement('strong');
      const person = document.createElement('span'); person.textContent = item.player.name;
      const count = document.createElement('span'); count.textContent = `${item.supporters.length} رأی`;
      line.append(person, count);
      const detail = document.createElement('p'); detail.textContent = item.supporters.length ? `رأی‌دهندگان: ${item.supporters.join('، ')}` : 'کسی به او رأی نداد';
      row.append(line, detail); return row;
    }));
  }
}
function leave() {
  roomId = null; current = null; previousStatus = '';
  sessionStorage.removeItem('voting_room_id'); clearInterval(pollId); pollId = null;
  $('room').hidden = true; $('home').hidden = false; notice('');
  history.replaceState(null, '', location.pathname);
}
$('create').addEventListener('click', () => action(async () => {
  const name = $('name').value.trim(); if (!name) throw new Error('اول اسم خودت را بنویس.');
  await ensureGuest(); const result = await call('create_voting_room', { player_name: name });
  await enter(result.room_id);
}));
$('join').addEventListener('click', () => action(async () => {
  const name = $('name').value.trim(); const code = $('code').value.trim();
  if (!name || !code) throw new Error('اسم و کد اتاق را وارد کن.');
  await ensureGuest(); const result = await call('join_voting_room', { room_code: code, player_name: name });
  await enter(result.room_id);
}));
$('start').addEventListener('click', () => action(async () => { await call('start_voting', { p_room_id: roomId }); await refresh(); }));
$('finish').addEventListener('click', () => {
  if (!confirm('رأی‌گیری را تمام کنیم و نتیجه را به همه نشان بدهیم؟')) return;
  action(async () => { await call('finish_voting', { p_room_id: roomId }); await refresh(); });
});
$('copy').addEventListener('click', () => action(async () => {
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(current.code)}`;
  await navigator.clipboard.writeText(link); notice('لینک دعوت کپی شد.');
}));
$('leave').addEventListener('click', leave);
const inviteCode = new URLSearchParams(location.search).get('room');
if (inviteCode) $('code').value = inviteCode.toUpperCase();
if (roomId) ensureGuest().then(() => enter(roomId)).catch(() => leave());
