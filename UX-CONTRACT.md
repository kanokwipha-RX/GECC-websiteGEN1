# GECC behavior contract

Canonical owners: index.html shell/go (navigation), .inp/native inputs/select/date
(forms), openModal/closeModal (dialogs), toast/#toasts (feedback), .tbl-wrap/table
(tabular data), assets/premium.css (global scrollbar/focus), assets/motion.js
(motion). No table-selection UI is introduced. Locale is th-TH with Buddhist year
display, preserving existing date helpers and ISO storage dates.

Navigation must respect unsaved-change confirmation. Rendering cannot discard a
draft. Success is announced only after durable save. API failure leaves a visible
retry/reload warning and the local draft intact, never a silent local fallback.

Local mode preserves the incumbent browser data and demo PIN experience and is
explicitly labelled. Server mode starts empty/public, never reads local records,
never seeds demo assessments and never honors demo hash login. Session and resource
permissions are server authoritative. Public assessment statistics are aggregates.

Organization: own assessment/evidence and defect responses; cannot edit scores,
reviewer feedback or locked records. Reviewer: assigned group, score/review/return/
reopen. Coordinator: all groups, settings and accounts. Locked assessments require
explicit reopen reason. Server generates audit actor/timestamps and workflow logs.

New async actions retain button geometry and disable repeats while pending.
Session expiry and version conflict must stop save; explicit reload requires
confirmation if a draft is dirty. Import never silently overwrites existing data.
