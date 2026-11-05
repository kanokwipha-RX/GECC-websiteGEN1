/* GECC Example Library UI & Modal Explorer */
"use strict";

function libraryExamplesSectionHTML() {
  const cards = window.LIBRARY_EXAMPLES || [];
  if (!cards.length) return '';
  return `
    <section class="library-examples-section">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:24px">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="display:inline-flex;padding:7px;background:rgba(212,175,55,0.18);color:#B8862B;border-radius:10px">${ic('folder')}</span>
            <h2 style="margin:0;font-size:clamp(22px,2.2vw,28px);color:var(--navy);font-weight:700">ตัวอย่างเอกสารและแนวทางการประเมิน GECC</h2>
          </div>
          <p style="margin:6px 0 0 44px;color:var(--text-2);font-size:14.5px">ไฟล์ตัวอย่างจริงจากหน่วยงาน แบบติดตามเช็คลิสต์ แบบฟอร์มแยกตามเกณฑ์ 3 ด้าน และคำสั่งโครงการ (รวม 5 การ์ด 889 ไฟล์)</p>
        </div>
      </div>
      <div class="examples-grid">
        ${cards.map(c => `
          <div class="example-card" data-visual-card style="--card-accent:${c.theme};border-top:4px solid ${c.theme}">
            <div class="ex-card-head">
              <span class="ex-cat-badge">${esc(c.category)}</span>
              <span class="ex-file-badge">${esc(c.badge)}</span>
            </div>
            <div class="ex-card-body">
              <div class="ex-card-title-row">
                <span class="ex-card-icon" style="background:${c.theme}18;color:${c.theme}">${ic(c.icon || 'file')}</span>
                <h3>${esc(c.name)}</h3>
              </div>
              <p class="ex-card-desc">${esc(c.detail)}</p>
            </div>
            <div class="ex-card-foot">
              ${c.singleFile ? `
                <a class="btn btn-lux btn-sm w-full" href="${esc(c.url)}" download="${esc(c.fileName)}" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px">
                  ${ic('download')}<span>ดาวน์โหลดไฟล์ (${esc(c.fileName)})</span>
                </a>
              ` : `
                <button class="btn btn-lux btn-sm w-full" data-act="open-ex-modal" data-ex-id="${esc(c.id)}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px">
                  ${ic('folder')}<span>เปิดดูรายการไฟล์ (${c.fileCount} ไฟล์) ${ic('right')}</span>
                </button>
              `}
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function openExampleModal(exId, filterSubfolder, searchQ) {
  const c = (window.LIBRARY_EXAMPLES || []).find(x => x.id === exId);
  if (!c) return;
  S._currentExModal = { exId, filter: filterSubfolder || 'all', q: searchQ || '' };
  renderExampleModalContent();
}

function renderExampleModalContent() {
  const state = S._currentExModal;
  if (!state) return;
  const c = (window.LIBRARY_EXAMPLES || []).find(x => x.id === state.exId);
  if (!c) return;

  const allFiles = c.files || [];
  const subfolderSet = new Set();
  allFiles.forEach(f => {
    if (f.subfolder) {
      const topSub = f.subfolder.split(' / ')[0];
      if (topSub) subfolderSet.add(topSub);
    }
  });
  const subfolders = Array.from(subfolderSet);

  const q = (state.q || '').trim().toLowerCase();
  const filter = state.filter || 'all';

  const filtered = allFiles.filter(f => {
    if (filter !== 'all') {
      const topSub = (f.subfolder || '').split(' / ')[0];
      if (topSub !== filter) return false;
    }
    if (q) {
      const matchName = f.name.toLowerCase().includes(q);
      const matchSub = (f.subfolder || '').toLowerCase().includes(q);
      if (!matchName && !matchSub) return false;
    }
    return true;
  });

  const modalHtml = `
    <div class="modal-h" style="border-bottom:1px solid rgba(15,34,99,.1);padding-bottom:16px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span class="ex-cat-badge">${esc(c.category)}</span>
          <span class="ex-file-badge">${esc(c.badge)}</span>
        </div>
        <h3 style="margin:0;font-size:20px;color:var(--navy)">${esc(c.name)}</h3>
      </div>
      <button class="btn btn-ghost btn-icon" data-act="modal-close" aria-label="ปิด">${ic('x')}</button>
    </div>
    <div class="modal-b" style="padding-top:16px;max-height:75vh;overflow-y:auto">
      <div style="margin-bottom:14px;position:relative">
        <input class="inp w-full" type="search" id="ex-file-search" value="${esc(state.q)}" placeholder="พิมพ์ชื่อไฟล์หรือหัวข้อเพื่อค้นหา... (พบ ${filtered.length} จาก ${allFiles.length} ไฟล์)" style="padding-left:14px;height:42px">
      </div>
      ${subfolders.length > 0 ? `
        <div class="ex-modal-filter-bar">
          <button class="ex-chip${filter==='all'?' is-active':''}" data-act="ex-subfolder" data-sub="all">ทั้งหมด (${allFiles.length})</button>
          ${subfolders.map(s => {
            const cnt = allFiles.filter(f => (f.subfolder||'').split(' / ')[0] === s).length;
            return `<button class="ex-chip${filter===s?' is-active':''}" data-act="ex-subfolder" data-sub="${esc(s)}">${esc(s)} (${cnt})</button>`;
          }).join('')}
        </div>
      ` : ''}
      <div class="ex-files-container" style="margin-top:12px">
        ${filtered.length === 0 ? `
          <div style="text-align:center;padding:36px 16px;color:var(--text-3)">
            ${ic('file')}
            <p style="margin:8px 0 0;font-size:15px">ไม่พบไฟล์ที่ตรงกับคำค้นหา</p>
          </div>
        ` : `
          ${filtered.map(f => {
            const ext = (f.ext || '').toLowerCase();
            const extClass = ['docx','doc','pdf','xlsx','xls','pptx','ppt','rar','zip'].includes(ext) ? 'ext-'+ext : 'ext-other';
            const isPdf = ext === 'pdf';
            return `
              <div class="ex-file-row">
                <div class="ex-file-info">
                  <span class="ex-file-ext-icon ${extClass}">${esc(ext)}</span>
                  <div class="ex-file-names">
                    <div class="ex-file-name-txt">${esc(f.name)}</div>
                    ${f.subfolder ? `<div class="ex-file-subfolder">${ic('folder')} <span>${esc(f.subfolder)}</span></div>` : ''}
                  </div>
                </div>
                <div class="ex-file-actions">
                  <span class="ex-file-size">${esc(f.size)}</span>
                  ${isPdf ? `
                    <a class="btn btn-ghost btn-sm" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer" title="เปิดดูเอกสาร">
                      ${ic('eye')}<span>เปิดดู</span>
                    </a>
                  ` : ''}
                  <a class="btn btn-lux btn-sm" href="${esc(f.url)}" download="${esc(f.name)}" title="ดาวน์โหลดไฟล์">
                    ${ic('download')}<span>ดาวน์โหลด</span>
                  </a>
                </div>
              </div>
            `;
          }).join('')}
        `}
      </div>
    </div>
  `;

  openModal(modalHtml);

  const searchInput = $('#ex-file-search');
  if (searchInput) {
    searchInput.focus();
    const val = searchInput.value;
    searchInput.value = '';
    searchInput.value = val;
    searchInput.oninput = (e) => {
      S._currentExModal.q = e.target.value;
      renderExampleModalContent();
    };
  }
}
