/* Public views share the existing shell, modal, fields and identity. */
window.GECCPublic = (() => {
  let content=null, rows=null, timer=null, editorRevision=null, editTeams=null, loginUnits=null, loginOptions=null, loginError=null, rosterLoading=false, rosterGeneration=0;
  const php=()=>window.GECC_SERVER&&window.GECC_API_STYLE==='php';
  const request=(route,opts)=>GECCClient.request('/api/'+route,opts);
  const post=(method,value)=>({method,body:JSON.stringify(value)});
  const safe=s=>esc(String(s??''));
  const defaults={albums:[
    {
      title:'กิจกรรม GECC · 4 พฤศจิกายน 2569',date:'2026-11-04',description:'',status:'published',
      images:Array.from({length:38},(_,i)=>({src:`assets/gallery/gallery-2026-11-04-${String(i+1).padStart(2,'0')}.jpg`,alt:`ภาพกิจกรรม GECC วันที่ 4 พฤศจิกายน 2569 ภาพที่ ${i+1}`}))
    },
    {
    title:'กิจกรรม GECC · 29 ตุลาคม 2569',date:'2026-10-29',description:'',status:'published',
    images:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,41,42,43,48].map((n,i)=>({src:`assets/gallery/gallery-2026-10-29-${String(n).padStart(2,'0')}.jpg`,alt:`ภาพกิจกรรม GECC วันที่ 29 ตุลาคม 2569 ภาพที่ ${i+1}`}))
  }],videos:[
    {title:'ที่ดิน',category:'physical',url:'https://youtu.be/SdC2g6AkotE',status:'published'},
    {title:'ไฟฟ้า',category:'physical',url:'assets/videos/gecc-pea-sisaket.mp4',status:'published'},
    {title:'สสจ.',category:'physical',url:'https://drive.google.com/file/d/1iuE46Q_0NX8mANzZDdmUdSfyQYGWP-E9/view',status:'published'},
    {title:'ศูนย์ดำรงธรรม',category:'physical',url:'assets/videos/gecc-damrongtham-sisaket.mp4',status:'published'},
    {title:'ที่ดิน',category:'highlight',url:'https://youtu.be/UgtOfqhBWU0',status:'published'},
    {title:'ไฟฟ้า',category:'highlight',url:'assets/videos/gecc-pea-sisaket.mp4',status:'published'},
    {title:'สสจ.',category:'highlight',url:'https://drive.google.com/file/d/1vicDgdaiNTb9BM9jqIP2sBJEhEYNS8QW/view',status:'published'},
    {title:'ศูนย์ดำรงธรรม',category:'highlight',url:'assets/videos/gecc-damrongtham-sisaket.mp4',status:'published'}]};
  async function load(){
    if(php()){
      content=await request('public/content');
      const savedAlbums=content.albums||[];
      const missingAlbums=defaults.albums.filter(a=>!savedAlbums.some(b=>b.date===a.date&&b.title===a.title));
      content.albums=[...savedAlbums,...missingAlbums];
      const savedVideos=content.videos||[];
      const videos=defaults.videos.map(dv=>{
        const found=savedVideos.find(sv=>sv.title===dv.title&&sv.category===dv.category);
        return (found&&found.url)?found:dv;
      });
      const extraVideos=savedVideos.filter(sv=>!defaults.videos.some(dv=>dv.title===sv.title&&dv.category===sv.category));
      content.videos=[...videos,...extraVideos];
      return content;
    }
    const saved=DB.publicContent||{},albums=saved.albums||[];
    const missing=defaults.albums.filter(a=>!albums.some(b=>b.date===a.date&&b.title===a.title));
    const savedVideos=saved.videos||[];
    const videos=defaults.videos.map(dv=>{
      const found=savedVideos.find(sv=>sv.title===dv.title&&sv.category===dv.category);
      return (found&&found.url)?found:dv;
    });
    return content={...defaults,mentorAdvisors:MENTOR_ADVISORS,...saved,videos,albums:[...albums,...missing]};
  }
  function embed(url){try{const u=new URL(url);if(u.protocol!=='https:')return '';if(['youtu.be','youtube.com','www.youtube.com'].includes(u.hostname)){const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v');return /^[\w-]{11}$/.test(id||'')?'https://www.youtube-nocookie.com/embed/'+id:'';}if(u.hostname==='drive.google.com'){const id=u.pathname.match(/^\/file\/d\/([\w-]+)\//)?.[1];return id?'https://drive.google.com/file/d/'+id+'/preview':'';}}catch{}return '';}
  function error(e){toast(e.message||'โหลดข้อมูลไม่สำเร็จ',true);}
  const galleryVideoNames={
    'ที่ดิน':'สำนักงานที่ดินจังหวัดศรีสะเกษ',
    'ไฟฟ้า':'การไฟฟ้าส่วนภูมิภาคจังหวัดศรีสะเกษ',
    'สสจ.':'ศูนย์บริการผลิตภัณฑ์สุขภาพเบ็ดเสร็จ สำนักงานสาธารณสุขจังหวัดศรีสะเกษ',
    'ศูนย์ดำรงธรรม':'ศูนย์ดำรงธรรมจังหวัดศรีสะเกษ'
  };

  const galleryVideoName=title=>Object.hasOwn(galleryVideoNames,title)?galleryVideoNames[title]:title;
  async function gallery(){
    clearInterval(timer);setCollectionHead('Gallery','image','ภาพกิจกรรมและวิดีโอ GECC จังหวัดศรีสะเกษ');
    $('#content').innerHTML='<p role="status">กำลังโหลด Gallery…</p>';
    try{const c=await load();if(S.view!=='gallery')return;
      const albums=(c.albums||[]).filter(a=>a.status==='published').sort((a,b)=>b.date.localeCompare(a.date));
      $('#content').innerHTML=`<section class="public-intro"><h2>บันทึกกิจกรรม GECC</h2><p>ภาพกิจกรรมเรียงตามวันที่ล่าสุด แกลเลอรีสไลด์แผ่นฟิล์มเลื่อนไหลแบบ 3 มิติ</p></section>${albums.length?albums.map((a,i)=>`<article class="card album film-album" data-album="${i}">
        <div class="film-album-head">
          <div class="film-album-title-group">
            <h2>${safe(a.title)}</h2>
            <p class="film-album-meta"><span class="film-pill">ALBUM</span> ${thDate(a.date)}${a.description?` · ${safe(a.description)}`:''}</p>
          </div>
          <div class="film-counter-badge" aria-label="ลำดับภาพ">
            <span class="film-curr" data-curr>1</span> / <span>${a.images.length}</span>
          </div>
        </div>
        ${a.images.length?`
          <div class="film-stage-viewport" role="region" aria-label="สไลด์โชว์แผ่นฟิล์ม ${safe(a.title)}" tabindex="0">
            <div class="film-ambient-glow" aria-hidden="true" style="background-image:url('${safe(a.images[0].src)}')"></div>
            <div class="film-rail top-rail" aria-hidden="true"><div class="film-sprockets-row"></div></div>
            <div class="film-deck">
              ${a.images.map((im,j)=>`
                <div class="film-card" data-card-idx="${j}" role="button" tabindex="${j===0?'0':'-1'}" aria-label="ดูภาพที่ ${j+1}">
                  <div class="film-card-frame">
                    <div class="film-card-header">
                      <div class="film-perfs"><span class="film-perf"></span><span class="film-perf"></span><span class="film-perf"></span></div>
                      <span class="film-card-tag">GECC-SK · #${String(j+1).padStart(2,'0')}</span>
                    </div>
                    <div class="film-card-body">
                      <img src="${safe(im.src)}" alt="${safe(im.alt||'')}" loading="${j<6?'eager':'lazy'}" decoding="async">
                      <div class="film-card-glass"></div>
                    </div>
                    <div class="film-card-footer">
                      <div class="film-perfs"><span class="film-perf"></span><span class="film-perf"></span><span class="film-perf"></span></div>
                      <span class="film-card-count">${j+1} / ${a.images.length}</span>
                    </div>
                  </div>
                </div>
              `).join('')}
              <button type="button" class="film-arrow film-arrow-prev" data-prev aria-label="ภาพก่อนหน้า">${ic('left')}</button>
              <button type="button" class="film-arrow film-arrow-next" data-next aria-label="ภาพถัดไป">${ic('right')}</button>
            </div>
            <div class="film-rail bottom-rail" aria-hidden="true"><div class="film-sprockets-row"></div></div>
          </div>
          <div class="film-thumbs-strip">
            <button type="button" class="film-thumbs-nav" data-thumb-prev aria-label="เลื่อนแถบภาพย่อไปซ้าย">${ic('left')}</button>
            <div class="album-thumbs film-thumbs" role="tablist">
              ${a.images.map((im,j)=>`
                <button type="button" class="film-thumb-btn" data-slide="${j}" aria-label="เลือกภาพที่ ${j+1}" aria-pressed="${j===0}">
                  <img src="${safe(im.src)}" alt="" width="68" height="46" loading="lazy" decoding="async">
                  <span class="film-thumb-num">${j+1}</span>
                </button>
              `).join('')}
            </div>
            <button type="button" class="film-thumbs-nav" data-thumb-next aria-label="เลื่อนแถบภาพย่อไปขวา">${ic('right')}</button>
          </div>
          <div class="feature-tools film-controls-bar">
            <button class="btn btn-outline" type="button" data-prev>${ic('left')} ก่อนหน้า</button>
            <button class="btn btn-primary film-pause-btn" type="button" data-pause aria-pressed="false">${ic('pause')} หยุดสไลด์</button>
            <button class="btn btn-outline" type="button" data-next>ถัดไป ${ic('right')}</button>
            <button class="btn film-zoom-btn" type="button" data-zoom title="ขยายดูภาพขนาดใหญ่">${ic('maximize')} ขยายภาพ</button>
            <div class="film-timer-bar" title="ตัวนับเวลาสไลด์อัตโนมัติ"><div class="film-timer-fill"></div></div>
            <span role="status" class="film-counter-text" data-position>1 / ${a.images.length}</span>
          </div>
        `:'<p>รอภาพกิจกรรม</p>'}
      </article>`).join(''):'<div class="card album"><h2>ภาพกิจกรรมคณะทำงาน</h2><p>รอเพิ่มอัลบั้มและวันที่กิจกรรมจากผู้ประสานงาน</p></div>'}${[['physical','ด้านกายภาพ / สถานที่'],['highlight','ผลงานเด่น'],['activity','กิจกรรมคณะทำงาน']].map(([cat,label])=>`<h2 class="section-t">${label}</h2><div class="feature-grid">${(c.videos||defaults.videos).filter(v=>v.category===cat&&v.status==='published').map(v=>{const isDirect=/\.(mp4|webm|mov)(\?.*)?$/i.test(v.url||'');const em=embed(v.url||'');return `<article class="card album"><h3>${safe(galleryVideoName(v.title))}</h3>${isDirect?`<video class="feature-video" controls preload="metadata" playsinline poster="" src="${safe(v.url)}"><p>เบราว์เซอร์ของคุณไม่รองรับการเล่นวิดีโอ</p></video><p>หากเล่นไม่ได้ ให้เปิดวิดีโอจากต้นทาง</p><a class="btn" href="${safe(v.url)}" target="_blank" rel="noopener noreferrer" download>เปิดวิดีโอต้นทาง</a>`:em?`<iframe class="feature-video" src="${safe(em)}" title="${safe(label+' '+galleryVideoName(v.title))}" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe><p>หากเล่นไม่ได้ ให้เปิดวิดีโอจากต้นทาง</p><a class="btn" href="${safe(v.url)}" target="_blank" rel="noopener noreferrer">เปิดวิดีโอต้นทาง</a>`:'<p>รอข้อมูล</p>'}</article>`;}).join('')||'<p>รอเพิ่มวิดีโอ</p>'}</div>`).join('')}`;


      const controls=[];
      document.querySelectorAll('[data-album]').forEach(el=>{
        const a=albums[+el.dataset.album];
        if(!a.images.length) return;
        let idx=0, paused=false, hover=false;
        const total = a.images.length;
        const cards = el.querySelectorAll('.film-card');
        const thumbs = el.querySelectorAll('.film-thumb-btn');
        const glow = el.querySelector('.film-ambient-glow');
        const currNum = el.querySelector('[data-curr]');
        const posText = el.querySelector('[data-position]');
        const strip = el.querySelector('.film-thumbs');
        const timerFill = el.querySelector('.film-timer-fill');

        const updatePositions = () => {
          const w = el.clientWidth || window.innerWidth;
          const isSm = w <= 600;
          const isMd = w <= 960 && !isSm;
          const stepX = isSm ? 110 : (isMd ? 190 : 270);
          const stepZ = isSm ? 50 : 90;
          const stepRot = isSm ? 12 : 20;

          cards.forEach((card, j) => {
            let diff = ((j - idx) % total + total) % total;
            if (diff > total / 2) diff -= total;

            const absDiff = Math.abs(diff);
            if (absDiff <= 3) {
              card.style.display = 'block';
              card.style.visibility = 'visible';
              card.setAttribute('aria-hidden', diff === 0 ? 'false' : 'true');
              card.tabIndex = diff === 0 ? 0 : -1;
              card.classList.toggle('is-center', diff === 0);

              const x = diff * stepX;
              const z = -absDiff * stepZ;
              const scale = Math.max(0.55, 1 - absDiff * (isSm ? 0.16 : 0.14));
              const rotY = -Math.sign(diff) * Math.min(38, absDiff * stepRot);
              const opacity = diff === 0 ? 1 : Math.max(0, 1 - absDiff * (isSm ? 0.32 : 0.24));
              const brightness = diff === 0 ? 1 : Math.max(0.42, 1 - absDiff * 0.18);
              const zIndex = 30 - absDiff * 6;

              card.style.transform = `translate3d(calc(-50% + ${x}px), -50%, ${z}px) scale(${scale}) rotateY(${rotY}deg)`;
              card.style.opacity = opacity;
              card.style.filter = `brightness(${brightness})`;
              card.style.zIndex = zIndex;
            } else {
              card.style.display = 'none';
              card.style.visibility = 'hidden';
              card.style.opacity = '0';
              card.setAttribute('aria-hidden', 'true');
              card.tabIndex = -1;
              card.classList.remove('is-center');
            }
          });

          if (glow && a.images[idx]) {
            glow.style.backgroundImage = `url('${a.images[idx].src}')`;
          }

          if (currNum) currNum.textContent = idx + 1;
          if (posText) posText.textContent = `${idx + 1} / ${total}`;

          thumbs.forEach((b, j) => {
            const isAct = j === idx;
            b.setAttribute('aria-pressed', isAct ? 'true' : 'false');
            b.classList.toggle('is-active', isAct);
          });
          const actThumb = thumbs[idx];
          if (actThumb && strip) {
            actThumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          }

          if (timerFill) {
            timerFill.style.transition = 'none';
            timerFill.style.width = '0%';
            requestAnimationFrame(() => {
              if (!paused && !hover) {
                timerFill.style.transition = 'width 4.9s linear';
                timerFill.style.width = '100%';
              }
            });
          }
        };

        const show = (n) => {
          idx = ((n % total) + total) % total;
          updatePositions();
        };

        el.addEventListener('click', (e) => {
          const card = e.target.closest('.film-card');
          if (card) {
            const cardIdx = +card.dataset.cardIdx;
            if (cardIdx !== idx) {
              show(cardIdx);
              return;
            } else if (e.target.closest('.film-card-body')) {
              openZoomModal(a.images[idx], idx, total);
              return;
            }
          }

          const btn = e.target.closest('button');
          if (!btn) return;

          if (btn.hasAttribute('data-slide')) show(+btn.dataset.slide);
          if (btn.hasAttribute('data-prev')) show(idx - 1);
          if (btn.hasAttribute('data-next')) show(idx + 1);
          if (btn.hasAttribute('data-thumb-prev')) {
            if (strip) strip.scrollBy({ left: -240, behavior: 'smooth' });
          }
          if (btn.hasAttribute('data-thumb-next')) {
            if (strip) strip.scrollBy({ left: 240, behavior: 'smooth' });
          }
          if (btn.hasAttribute('data-zoom')) openZoomModal(a.images[idx], idx, total);
          if (btn.hasAttribute('data-pause')) {
            paused = !paused;
            btn.setAttribute('aria-pressed', paused);
            btn.innerHTML = paused ? `${ic('play')} เล่นสไลด์` : `${ic('pause')} หยุดสไลด์`;
            if (timerFill) {
              if (paused) timerFill.style.width = '0%';
              else {
                timerFill.style.transition = 'width 4.9s linear';
                timerFill.style.width = '100%';
              }
            }
          }
        });

        el.onpointerenter = () => { hover = true; };
        el.onpointerleave = () => { hover = false; };

        el.onkeydown = (e) => {
          if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            show(idx + (e.key === 'ArrowRight' ? 1 : -1));
          }
        };

        let startX = 0, startY = 0;
        el.addEventListener('touchstart', e => {
          if (e.touches.length === 1) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
          }
        }, { passive: true });
        el.addEventListener('touchend', e => {
          if (e.changedTouches.length === 1) {
            const dx = e.changedTouches[0].clientX - startX;
            const dy = e.changedTouches[0].clientY - startY;
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
              show(idx + (dx < 0 ? 1 : -1));
            }
          }
        }, { passive: true });

        let rAF = null;
        const onResize = () => {
          if (rAF) cancelAnimationFrame(rAF);
          rAF = requestAnimationFrame(() => { if (S.view === 'gallery') updatePositions(); });
        };
        window.addEventListener('resize', onResize);

        updatePositions();

        controls.push(() => {
          if (!paused && !hover && !el.contains(document.activeElement) && !document.hidden && a.images.length > 1) {
            show(idx + 1);
          }
        });
      });

      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        timer = setInterval(() => {
          if (S.view !== 'gallery') { clearInterval(timer); return; }
          controls.forEach(f => f());
        }, 5000);
      }
    }catch(e){
      $('#content').innerHTML='<p role="alert">โหลด Gallery ไม่สำเร็จ กรุณาลองใหม่</p><button class="btn" data-act="go" data-view="gallery">ลองโหลด Gallery อีกครั้ง</button>';
      error(e);
    }
  }

  function openZoomModal(im, idx, total) {
    if (!im) return;
    openModal(`<div class="modal-h film-zoom-modal-head">
      <div style="flex:1">
        <h3>ภาพที่ ${idx + 1} จาก ${total}</h3>
        <p style="margin:4px 0 0;color:var(--text-3);font-size:13px">${esc(im.alt || 'ภาพกิจกรรม GECC จังหวัดศรีสะเกษ')}</p>
      </div>
      <button class="btn btn-ghost btn-icon" data-act="modal-close" aria-label="ปิด">${ic('x')}</button>
    </div>
    <div class="modal-b film-zoom-modal-body" style="padding:12px;background:#050B1E;display:flex;justify-content:center;align-items:center;border-radius:12px;overflow:hidden">
      <img src="${safe(im.src)}" alt="${safe(im.alt || '')}" style="max-width:100%;max-height:78vh;object-fit:contain;border-radius:8px;box-shadow:0 12px 36px rgba(0,0,0,0.6)">
    </div>
    <div class="modal-f" style="justify-content:space-between">
      <a class="btn" href="${safe(im.src)}" target="_blank" rel="noopener noreferrer" download>${ic('download')} บันทึกภาพต้นฉบับ</a>
      <button class="btn btn-primary" data-act="modal-close">ปิดหน้าต่าง</button>
    </div>`);
  }

  async function mentors(){try{setCollectionHead('MENTOR','users','ทีมพี่เลี้ยงประจำ 6 กลุ่ม');await load();if(S.view!=='mentors')return;$('#content').innerHTML=DB.teams.map(t=>`<section><h2 class="section-t">${safe(t.name)}</h2><div class="mentor-roster">${Array.from({length:Math.max(4,t.members?.length||0)},(_,i)=>personCard(t.members?.[i]||{title:'รอรายชื่อ MENTOR',role:'กลุ่มที่ '+t.id})).join('')}</div></section>`).join('');}catch(e){$('#content').innerHTML='<p role="alert">โหลดรายชื่อไม่สำเร็จ กรุณาเลือกเมนู MENTOR เพื่อลองใหม่</p>';error(e);}}
  function resetLoginOptions(){
    rosterGeneration++;loginOptions=null;loginUnits=null;loginError=null;rosterLoading=false;
  }
  async function loadLoginOptions(force=false){
    if(!window.GECC_SERVER||rosterLoading||(loginOptions&&!force))return;
    const generation=rosterGeneration;rosterLoading=true;loginError=null;
    try{const result=await request('public/login-options');if(generation===rosterGeneration){loginOptions=result;loginUnits=result.units;}}
    catch(e){if(generation===rosterGeneration)loginError=e.message||'โหลดรายชื่อไม่สำเร็จ';}
    finally{if(generation===rosterGeneration){rosterLoading=false;if(S.view==='portfolio')viewPortfolio();}}
  }
  async function units(){if(php())return rows=(await request('public/units')).units;return rows=allInfo(0).map(x=>({id:x.u.id,name:x.u.name,team:x.u.team,submission:x.subAll,criteria:x.sub,physical:x.a?.phys||[],quality:(x.a?.qc||[]).map(q=>q.subs),narrative:(x.a?.narr||[]).map(n=>n.score!=null),readiness:readyOf(x.a).st,workflow:x.a?.wf?.status||'draft',score:x.assessed?x.c.total:null,level:x.level,status:x.status,outcomes:['o11','o12','o13','o14','c22'].map(k=>x.a?.out?.[k]!=null),updatedAt:x.a?.updatedAt}));}
  const states={done:'ครบ',prog:'กำลังดำเนินการ',none:'ยังไม่ส่ง',ready:'พร้อม',notready:'ไม่พร้อม',draft:'ร่าง',submitted:'รอตรวจ',reviewed:'ตรวจแล้ว',returned:'ส่งกลับแก้ไข'};
  async function directory(filter={}){try{await units();openModal(`<div class="modal-h"><h3>รายละเอียดหน่วยบริการ</h3><button class="btn" data-act="modal-close">ปิด</button></div><div class="modal-b"><div class="feature-tools"><input class="inp" id="public-search" aria-label="ค้นหาหน่วยบริการ" placeholder="ค้นหาชื่อหน่วยบริการ"><select class="inp" id="public-team" aria-label="กรองกลุ่ม"><option value="">ทุกกลุ่ม</option>${DB.teams.map(t=>`<option value="${t.id}">${safe(t.name)}</option>`).join('')}</select></div><div id="public-results"></div></div>`);const draw=()=>{const q=$('#public-search').value,tm=$('#public-team').value;const list=rows.filter(r=>(!tm||r.team===+tm)&&r.name.includes(q)&&(!filter.key||(filter.values||[filter.value]).includes(filter.key==='criteria'?r.criteria[filter.field]:filter.key==='physicalStatus'?(r.physical.filter(v=>v===true).length===15?'full':r.physical.some(v=>v===true)?'part':'zero'):r[filter.key])));$('#public-results').innerHTML=`<p role="status">${list.length} หน่วยบริการ</p>`+list.map(r=>`<button class="btn public-unit" data-public-id="${safe(r.id)}"><b>${safe(r.name)}</b><br>กลุ่ม ${r.team} · ${states[r.submission]||safe(r.submission)} · ${r.score==null?'รอผล':fmt(r.score,1)+' คะแนน'}</button>`).join('');};$('#public-search').oninput=draw;$('#public-team').onchange=draw;draw();}catch(e){error(e);}}
  function detail(id){const r=rows.find(r=>r.id===id);if(!r)return;openModal(`<div class="modal-h"><h3>${safe(r.name)}</h3><button class="btn" data-act="modal-close">ปิด</button></div><div class="modal-b"><p>กลุ่ม ${r.team} · ${states[r.workflow]} · ${r.updatedAt?thDateTime(r.updatedAt):'ยังไม่บันทึก'}</p><h2>${r.score==null?'รอผลประเมินครบ':fmt(r.score,1)+' / 300 คะแนน'}</h2>${Object.entries(r.criteria).map(([k,v])=>`<p>${safe(({phys:'กายภาพ',qual:'คุณภาพ',qc:'Checklist',narr:'บรรยาย',out:'ผลลัพธ์'})[k])}: ${states[v]}</p>`).join('')}<h3>สถานะด้านกายภาพรายข้อ</h3><p>${Array.from({length:15},(_,i)=>`ข้อ ${i+1} ${safe(PHYS[i]?.s)}: ${r.physical[i]===true?'ครบ':r.physical[i]===false?'ต้องปรับปรุง':'ยังไม่บันทึก'}`).join(' · ')}</p><h3>คุณภาพ Checklist</h3>${r.quality.map((n,i)=>`<p>ประเด็น ${i+1}: ดำเนินการ ${n.filter(Boolean).length}/${n.length} รายการ<br>${n.map((done,j)=>`${j+1}. ${safe(QC[i]?.subs[j]?.s||QC[i]?.subs[j]?.t||'รายการ '+(j+1))}: ${done?'ครบ':'ยังขาด'}`).join('<br>')}</p>`).join('')}<h3>คะแนนบรรยายรายข้อ</h3><p>${r.narrative.map((done,i)=>`ข้อ ${i+1}: ${done?'มีผลตรวจ':'รอผล'}`).join(' · ')}</p><h3>ผลลัพธ์รายหัวข้อ</h3><p>${(r.outcomes||[]).map((done,i)=>`${['ความพึงพอใจ 1.1','ความพึงพอใจ 1.2','ความพึงพอใจ 1.3','ความพึงพอใจ 1.4','ความสะดวก 2.2'][i]}: ${done?'มีผล':'รอผล'}`).join(' · ')}</p><p>เอกสารหลักฐานและข้อเสนอแนะภายในเปิดดูได้หลังเข้าสู่ระบบตามสิทธิ์</p></div>`);}
  async function editor(){if(php()){const r=await request('admin/content');content=r.content;editTeams=r.teams;editorRevision=r.revision;}else content=DB.publicContent||{library:LIBRARY_FOLDERS,advisor:COMMITTEE_ADVISOR,committee:COMMITTEE_MEMBERS,duties:COMMITTEE_DUTIES,mentorAdvisors:MENTOR_ADVISORS,...defaults};openModal(`<div class="modal-h"><h3>จัดการ Gallery และเนื้อหาเผยแพร่</h3><button class="btn" data-act="modal-close">ปิด</button></div><form class="modal-b feature-editor" id="feature-content-form"><p>แก้ชื่อ ตำแหน่ง รูป คณะทำงาน ที่ปรึกษา อัลบั้ม และวิดีโอ ข้อมูลอัลบั้มใช้ title, date, description, status และ images (src, alt) เรียงรูปตามลำดับที่ต้องการ</p><label for="feature-json">ข้อมูลเนื้อหา JSON</label><textarea class="inp" id="feature-json" spellcheck="false">${safe(JSON.stringify(content,null,2))}</textarea><label for="feature-image">อัปโหลดภาพ Gallery (สูงสุด 8 MB)</label><input id="feature-image" type="file" accept="image/jpeg,image/png,image/webp"><p id="feature-upload-status" role="status"></p><p id="feature-save-status" role="status"></p><button class="btn btn-primary" type="submit">บันทึกเนื้อหา</button></form>`);enhanceEditor();$('#feature-image').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(!php())throw Error('อัปโหลดภาพใช้ได้เมื่อเชื่อมระบบ PHP');if(file.size>8388608)throw Error('ภาพต้องไม่เกิน 8 MB');const r=await request('admin/media',{method:'POST',body:file});$('#feature-upload-status').textContent='อัปโหลดแล้ว นำ src นี้ใส่ในอัลบั้ม: '+r.src;}catch(e){$('#feature-upload-status').textContent=e.message;}};$('#feature-content-form').onsubmit=async e=>{e.preventDefault();const submit=e.target.querySelector('button[type=submit]');if(submit.disabled)return;submit.disabled=true;submit.setAttribute('aria-busy','true');try{const value=JSON.parse($('#feature-json').value);const teams=value.teams;delete value.teams;if(php()){await request('admin/content',post('PUT',{revision:editorRevision,content:value,teams}));await GECCClient.boot();}else{DB.publicContent=value;if(teams)DB.teams=teams;await persist();}content=value;closeModal();toast('บันทึกเนื้อหาแล้ว');}catch(e){$('#feature-save-status').textContent=e.message;}finally{submit.disabled=false;submit.removeAttribute('aria-busy');}};}
  document.addEventListener('click',async e=>{
    if(S.view!=='exec'||S.role)return;
    const b=e.target.closest('[data-public-filter],[data-act="dual-list"],[data-act="crit-list"],[data-act="go-mdash"],[data-act="peek"],[data-public-name]');
    if(!b)return;e.preventDefault();e.stopImmediatePropagation();if(b.dataset.publicFilter)return directory({key:b.dataset.publicFilter.startsWith('phys:')?'physicalStatus':'level',value:b.dataset.publicFilter.replace('phys:','')});
    if(b.dataset.publicName||b.dataset.act==='peek'){try{await units();const r=rows.find(r=>b.dataset.id?r.id===b.dataset.id:r.name===b.dataset.publicName);if(r)detail(r.id);}catch(err){error(err);}return;}
    if(b.dataset.act==='crit-list')return directory({key:'criteria',field:b.dataset.k,value:b.dataset.s});
    if(b.dataset.act==='go-mdash')return directory({key:'status',value:b.dataset.f});
    const v={g:'done',o:'prog',r:'none'}[b.dataset.s];
    return directory(b.dataset.p==='1'?{key:'submission',value:v}:{key:'readiness',values:{g:['ready'],o:['draft','notready'],r:['none']}[b.dataset.s]});
  },true);
  document.addEventListener('keydown',e=>{const el=e.target.closest('[data-public-name],[data-public-filter]');if(el&&['Enter',' '].includes(e.key)){e.preventDefault();el.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
  function enhanceEditor(){
    const raw=$('#feature-json'), form=$('#feature-content-form');
    let model=JSON.parse(raw.value);model.teams=structuredClone(editTeams||DB.teams);model.albums??=[];model.videos??=structuredClone(defaults.videos);model.mentorAdvisors??=structuredClone(MENTOR_ADVISORS);
    const host=document.createElement('section');form.prepend(host);
    const fields=(obj,keys,prefix)=>keys.map(([key,label,type])=>`<label>${label}<${type==='textarea'?'textarea':'input'} class="inp" data-content-key="${prefix}.${key}" ${type==='textarea'?'':`type="${type||'text'}"`} ${type==='textarea'?'':`value="${safe(obj[key])}"`}>${type==='textarea'?safe(obj[key])+'</textarea>':''}</label>`).join('');
    const sync=()=>{raw.value=JSON.stringify(model,null,2);};
    const draw=()=>{host.innerHTML=`<label for="feature-survey">ลิงก์แบบสำรวจความพึงพอใจผู้รับบริการ</label><input class="inp" id="feature-survey" type="url" data-content-key="surveyUrl" value="${safe(model.surveyUrl)}" placeholder="https://"><p>เว้นว่างไว้เพื่อใช้ลิงก์แบบประเมินหลัก</p><h4>อัลบั้มภาพ</h4><button class="btn" type="button" data-add-album>เพิ่มอัลบั้ม</button>${model.albums.map((a,i)=>`<fieldset><legend>อัลบั้ม ${i+1}</legend>${fields(a,[['title','ชื่ออัลบั้ม'],['date','วันที่กิจกรรม','date'],['description','คำอธิบาย','textarea']],`albums.${i}`)}<label>การเผยแพร่<select class="inp" data-content-key="albums.${i}.status"><option value="draft" ${a.status==='draft'?'selected':''}>ร่าง</option><option value="published" ${a.status==='published'?'selected':''}>เผยแพร่</option></select></label><p>ภาพเรียงตามลำดับด้านล่าง</p>${(a.images||[]).map((im,j)=>fields(im,[['src','ที่อยู่ภาพ'],['alt','คำอธิบายภาพ']],`albums.${i}.images.${j}`)+`<button class="btn" type="button" data-remove-image="${i}:${j}">ลบภาพ ${j+1}</button>`).join('')}<button class="btn" type="button" data-add-image="${i}">เพิ่มช่องภาพ</button><button class="btn" type="button" data-remove-album="${i}">ลบอัลบั้ม</button></fieldset>`).join('')}<h4>วิดีโอ</h4><button class="btn" type="button" data-add-video>เพิ่มวิดีโอ</button>${model.videos.map((v,i)=>`<fieldset><legend>${safe(({physical:'ด้านกายภาพ',highlight:'ผลงานเด่น',activity:'กิจกรรม'})[v.category])}</legend><label>หมวด<select class="inp" data-content-key="videos.${i}.category">${[['physical','กายภาพ'],['highlight','ผลงานเด่น'],['activity','กิจกรรม']].map(([k,l])=>`<option value="${k}" ${v.category===k?'selected':''}>${l}</option>`).join('')}</select></label>${fields(v,[['title','ชื่อวิดีโอ'],['url','ลิงก์ YouTube / Google Drive']],`videos.${i}`)}<label>การเผยแพร่<select class="inp" data-content-key="videos.${i}.status"><option value="draft" ${v.status==='draft'?'selected':''}>ร่าง</option><option value="published" ${v.status==='published'?'selected':''}>เผยแพร่</option></select></label></fieldset>`).join('')}<h4>MENTOR ประจำกลุ่ม</h4>${model.teams.map((t,i)=>`<fieldset><legend>${safe(t.name)}</legend>${fields(t,[['name','ชื่อกลุ่ม']],`teams.${i}`)}${(t.members||[]).map((m,j)=>fields(m,[['name','ชื่อ MENTOR'],['pos','ตำแหน่ง'],['photo','ที่อยู่รูป']],`teams.${i}.members.${j}`)).join('')}</fieldset>`).join('')}<h4>ที่ปรึกษาคณะทำงาน</h4>${fields(model.advisor,[['name','ชื่อ'],['title','ตำแหน่ง'],['photo','ที่อยู่รูป']],'advisor')}<h4>บุคคลและตำแหน่ง</h4>${['committee','mentorAdvisors'].map(group=>(model[group]||[]).map((p,i)=>`<fieldset><legend>${group==='committee'?'คณะทำงาน':'ที่ปรึกษา MENTOR'} ${i+1}</legend>${fields(p,[['name','ชื่อ'],['title','ตำแหน่ง'],['role','หน้าที่'],['photo','ที่อยู่รูป']],`${group}.${i}`)}</fieldset>`).join('')).join('')}`;sync();};
    host.oninput=e=>{const path=e.target.dataset.contentKey;if(!path)return;const parts=path.split('.');let obj=model;for(const key of parts.slice(0,-1))obj=obj[key];obj[parts.at(-1)]=e.target.value;sync();};host.onchange=host.oninput;
    host.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-add-video'))model.videos.push({title:'',url:'',category:'activity',status:'draft'});else if(b.hasAttribute('data-add-album'))model.albums.unshift({title:'',date:todayISO(),description:'',status:'draft',images:[]});else if(b.hasAttribute('data-remove-album'))model.albums.splice(+b.dataset.removeAlbum,1);else if(b.hasAttribute('data-add-image'))model.albums[+b.dataset.addImage].images.push({src:'',alt:''});else if(b.hasAttribute('data-remove-image')){const [i,j]=b.dataset.removeImage.split(':').map(Number);model.albums[i].images.splice(j,1);}draw();};draw();
    const details=document.createElement('details');details.innerHTML='<summary>ข้อมูลขั้นสูงสำหรับผู้ดูแลระบบ</summary>';raw.before(details);details.append(raw);
  }
  const oldCommittee=viewCommittee;
  viewCommittee=function(){const c=DB.publicContent;if(c?.mentorAdvisors)MENTOR_ADVISORS.splice(0,MENTOR_ADVISORS.length,...c.mentorAdvisors);oldCommittee();};
  const oldSubmit=libAuthSubmit,oldLibrary=viewLibrary;
  libAuthSubmit=async function(){
    const inputVal=($('#lib-pass-in')?.value||'').trim();
    const clean=inputVal.toLowerCase();
    const isLocalMatch=(clean==='geccssk2027'||clean==='gecc2027ssk');
    if(!isLocalMatch&&!php()){return oldSubmit();}
    if(isLocalMatch){
      try{sessionStorage.setItem('gecc_library_auth','1');}catch(e){}
      S.libraryAuth=true;
    }
    if(php()){
      try{
        const r=await request('library',post('POST',{password:inputVal}));
        if(r&&r.folders){
          LIBRARY_FOLDERS.splice(0,LIBRARY_FOLDERS.length,...r.folders);
          S.libraryAuth=true;
          try{sessionStorage.setItem('gecc_library_auth','1');}catch(e){}
        }
      }catch(e){
        if(!isLocalMatch){error(e);return;}
      }
    }
    if(S.libraryAuth){
      toast('รหัสผ่านถูกต้อง ยินดีต้อนรับสู่ GECC Library');
      oldLibrary();
      document.querySelector('.library-source')?.remove();
    }else{
      oldSubmit();
    }
  };
  viewLibrary=function(){
    oldLibrary();
    if(S.libraryAuth&&php()&&(!LIBRARY_FOLDERS||LIBRARY_FOLDERS.length===0)){
      request('library').then(r=>{
        if(S.view!=='library')return;
        LIBRARY_FOLDERS.splice(0,LIBRARY_FOLDERS.length,...r.folders);
        document.querySelector('.library-source')?.remove();
      }).catch(()=>{});
    }
  };
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-public-id],[data-public-directory],[data-feature-editor],[data-act="lib-lock"]');
    if(!b)return;
    if(b.dataset.publicId)detail(b.dataset.publicId);
    if(b.hasAttribute('data-public-directory'))directory();
    if(b.hasAttribute('data-feature-editor'))editor().catch(error);
    if(b.dataset.act==='lib-lock'){
      e.preventDefault();
      e.stopImmediatePropagation();
      S.libraryAuth=false;
      try{sessionStorage.removeItem('gecc_library_auth');}catch{}
      LIBRARY_FOLDERS.splice(0);
      if(php()){request('library',{method:'DELETE'}).catch(()=>{});}
      toast('ออกจากระบบ Library เรียบร้อย');
      viewLibrary();
    }
  },true);
  const oldRender=render;render=function(){oldRender();decorate();};
  function surveyLinkHTML(){
    const value=DB.publicContent?.surveyUrl || 'https://gecc-survey.sskru-survey.workers.dev/login?gecc=1';
    try{const u=new URL(value);if(typeof value==='string'&&value.length<=2048&&u.protocol==='https:'&&!u.username&&!u.password)return `<a class="btn" href="${safe(u.href)}" target="_blank" rel="noopener noreferrer">ระบบสำรวจความพึงพอใจผู้รับบริการ</a>`;}catch{}
    return '<button class="btn" type="button" disabled aria-describedby="survey-pending">ระบบสำรวจความพึงพอใจผู้รับบริการ</button><span id="survey-pending" role="status">รอยืนยันลิงก์แบบสำรวจ</span>';
  }
  function decorate(){if(!$('#content'))return;if(S.view==='portfolio'&&window.GECC_SERVER&&!loginOptions&&!rosterLoading&&!loginError)loadLoginOptions();const height=$('.site-nav')?.offsetHeight;if(height)document.documentElement.style.setProperty('--site-nav-height',height+'px');if(S.view==='exec'&&!$('#public-directory-button'))$('#content').insertAdjacentHTML('afterbegin',`<div class="feature-tools"><button class="btn btn-primary" id="public-directory-button" data-public-directory>ดูรายละเอียดรายหน่วยบริการ</button>${surveyLinkHTML()}</div>`);if(S.view==='exec'){document.querySelectorAll('.pbc-k .pk').forEach((el,i)=>{el.dataset.publicFilter='phys:'+['full','part','zero'][i%3];el.setAttribute('role','button');el.tabIndex=0;});document.querySelectorAll('.lvl-tile').forEach((el,i)=>{if(el.dataset.publicFilter)return;el.dataset.publicFilter=['gold','silver','blue'][i%3];el.setAttribute('role','button');el.tabIndex=0;});}if(S.view==='settings'&&S.coord&&!$('#feature-editor-button'))$('#content').insertAdjacentHTML('afterbegin','<button class="btn btn-primary" id="feature-editor-button" data-feature-editor>จัดการ Gallery และเนื้อหาเผยแพร่</button>');}
  const observer=new MutationObserver(()=>{decorate();});observer.observe($('#app'),{childList:true,subtree:true});
  decorate();return {gallery,mentors,directory,editor,embed,loadLoginOptions,resetLoginOptions,get loginUnits(){return loginUnits;},get loginOptions(){return loginOptions;},get loginError(){return loginError;}};
})();
