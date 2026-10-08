from pathlib import Path
import re

p = Path('index.html')
s = p.read_text(encoding='utf-8')

# 1) Make bill collection initialization safe so Add Bill cannot fail on a missing/old bills array.
needle = "function normalizeState(){\n  state.settings = Object.assign({}, DEFAULT_SETTINGS, state.settings || {});"
if needle in s and "if (!Array.isArray(state.bills)) state.bills = [];" not in s[s.find(needle):s.find(needle)+400]:
    s = s.replace(needle, needle + "\n  if (!Array.isArray(state.bills)) state.bills = [];", 1)

# 2) Ensure one-occurrence override stores exist.
needle = "  if (!state.instanceStatusOverrides) state.instanceStatusOverrides = {};"
if needle in s:
    add = needle + "\n  if (!state.instancePaymentMethodOverrides) state.instancePaymentMethodOverrides = {};\n  if (!state.instanceTypeOverrides) state.instanceTypeOverrides = {};"
    s = s.replace(needle, add, 1)

# 3) Effective payment method/type helpers + account-specific labels.
helper_block = '''function findBill(id){ return state.bills.find(b => b.id === id); }
function effectivePaymentMethod(bill, key){
  return key !== undefined && state.instancePaymentMethodOverrides[key] !== undefined ? state.instancePaymentMethodOverrides[key] : bill.paymentMethod;
}
function effectiveBillType(bill, key){
  return key !== undefined && state.instanceTypeOverrides[key] !== undefined ? state.instanceTypeOverrides[key] : bill.type;
}
function reducesChecking(bill, key){
  return !!REDUCES_CHECKING_DEFAULT[effectivePaymentMethod(bill, key)];
}
function paymentSourceLabel(bill, key){
  const method = effectivePaymentMethod(bill, key);
  if (method === "afcu_checking") return "Leaves AFCU";
  if (method === "dfcu_checking") return "Leaves DFCU";
  if (method === "credit" || method === "autopay_credit") return "Credit card payment";
  if (method === "payroll") return "Payroll deduction";
  if (method === "included") return "Included payment";
  if (method === "debit" || method === "autopay_debit") return "Choose AFCU or DFCU";
  return PAYMENT_METHODS.find(m=>m.v===method)?.label || "Payment source";
}'''
start = s.find('function findBill(id)')
if start != -1:
    end = s.find('function effectiveStatus', start)
    if end != -1:
        s = s[:start] + helper_block + '\n' + s[end:]

# 4) Variable/minimum logic respects a one-payment bill-type override.
s = re.sub(r'function needsAmountConfirm\(bill, key\)\{[^\n]*\}',
           'function needsAmountConfirm(bill, key){ const type=effectiveBillType(bill,key); return type === "variable" || type === "cc_minimum" || !!bill.amountIsEstimate || !!bill.payInFull; }', s, count=1)

# 5) Paycheck-plan Add Bill uses an actually scrollable list.
add_modal = r'''function openAddToPaycheckModal(periodIndex){
  const eligible = state.bills.filter(b => b.active && !isAnnualish(b)).sort((a,b)=>a.name.localeCompare(b.name));
  openModal(`
    <h3 class="modal-title">Add a bill to this paycheck</h3>
    ${eligible.length ? `<div class="field"><label>Bill</label><select id="addBillSelect" class="select-input" size="${Math.min(8, Math.max(3, eligible.length))}" style="max-height:45vh;overflow-y:auto;">${eligible.map(b=>`<option value="${b.id}">${b.name}</option>`).join("")}</select><div class="muted-note" style="margin-top:6px;">Scroll the list to see every bill.</div></div>` : `<p class="muted-note">There are no active paycheck bills to add.</p>`}
    <div class="field"><label>Due date for this instance</label><input type="date" id="addBillDate" class="text-input" value="${isoDate(displayPayDate(periodIndex))}" /></div>
    <div class="modal-actions">
      <button class="btn" id="cancelAdd">Cancel</button>
      <button class="btn btn-primary" id="confirmAdd">Add</button>
    </div>
  `);
  document.getElementById("cancelAdd").onclick = closeModal;
  document.getElementById("confirmAdd").onclick = () => {
    const billSelect = document.getElementById("addBillSelect");
    if (!billSelect) return alert("There are no active bills to add.");
    const billId = billSelect.value;
    const dateStr = document.getElementById("addBillDate").value;
    const key = "extra_" + instanceKey(billId, fromISO(dateStr)) + "_" + Date.now();
    state.extraInstances.push({ id: uid("extra"), key, billId, dueDate: dateStr, periodIndex });
    scheduleSave();
    closeModal();
    renderPlan();
  };
}'''
start = s.find('function openAddToPaycheckModal(periodIndex)')
if start != -1:
    end = s.find('/* ---------- Modal shell ---------- */', start)
    if end != -1:
        s = s[:start] + add_modal + '\n\n' + s[end:]

# 6) Paycheck Plan > Edit gets one-time amount/date/status/source/type overrides.
occ_modal = r'''function openOccurrenceModal(bill,key){
  const inst = getInstancesForPeriod(currentView === "home" ? todayIndex() : currentPeriodIndex).find(item=>item.key===key);
  const original = inst?.dueDate ? isoDate(inst.dueDate) : "";
  openModal(`<h3 class="modal-title">Edit payment · ${safeText(bill.name)}</h3>
    <p class="muted-note">These changes apply only to this payment. Use Edit recurring bill for the usual amount, schedule and account settings.</p>
    <div class="field"><label>Payment amount</label><input type="number" min="0" step="0.01" id="occAmount" class="text-input" value="${inputMoney(effectiveAmount(bill,key))}" /></div>
    <div class="field"><label>Due date for this payment</label><input type="date" id="occDue" class="text-input" value="${original}" /></div>
    <div class="field"><label>Status for this payment</label><select class="select-input" id="occStatus">${STATUSES.filter(status=>status.v!=="paid").map(status=>`<option value="${status.v}" ${status.v===effectiveStatus(bill,key)?"selected":""}>${status.label}</option>`).join("")}</select></div>
    <div class="field-row">
      <div class="field"><label>Money source for this payment</label><select class="select-input" id="occPaymentMethod">${paymentMethodOptions(effectivePaymentMethod(bill,key))}</select></div>
      <div class="field"><label>Bill type for this payment</label><select class="select-input" id="occType">${BILL_TYPES.map(t=>`<option value="${t.v}" ${t.v===effectiveBillType(bill,key)?"selected":""}>${t.label}</option>`).join("")}</select></div>
    </div>
    <p class="muted-note" style="margin-top:-6px;">Money source and bill type changes here apply to this payment only. Future bills keep their normal settings.</p>
    <div class="modal-actions"><button class="btn" id="occCancel">Cancel</button><button class="btn" id="occRecurring">Edit recurring bill</button><button class="btn btn-primary" id="occSave">Save payment</button></div>`);
  document.getElementById("occCancel").onclick = closeModal;
  document.getElementById("occRecurring").onclick = ()=>openBillModal(bill);
  document.getElementById("occSave").onclick = ()=>{
    const input = document.getElementById("occAmount");
    const amount = Number(input.value);
    if (!input.value || !Number.isFinite(amount) || amount<0) return alert("Enter a valid amount.");
    const due = document.getElementById("occDue").value;
    if (!due) return alert("Enter a due date.");
    if (state.completed[key]) return alert("This payment is already recorded as paid. Uncheck it before changing its record.");
    confirmAmount(bill,key,amount);
    state.paymentDueDates[key] = due;
    const occStatus = document.getElementById("occStatus").value;
    const occMethod = document.getElementById("occPaymentMethod").value;
    const occType = document.getElementById("occType").value;
    if (occStatus === bill.status) delete state.instanceStatusOverrides[key]; else state.instanceStatusOverrides[key] = occStatus;
    if (occMethod === bill.paymentMethod) delete state.instancePaymentMethodOverrides[key]; else state.instancePaymentMethodOverrides[key] = occMethod;
    if (occType === bill.type) delete state.instanceTypeOverrides[key]; else state.instanceTypeOverrides[key] = occType;
    scheduleSave();closeModal();renderPlan();
  };
}'''
start = s.find('function openOccurrenceModal(bill,key)')
if start != -1:
    end = s.find('/* ---------- Bill edit modal ---------- */', start)
    if end != -1:
        s = s[:start] + occ_modal + '\n\n' + s[end:]

# 7) Save path for brand-new bills is defensive.
old = '''    if (isNew) {
      const newBill = Object.assign({ id: uid("bill"), trackingStartIndex: todayIndex() }, patch);
      state.bills.push(newBill);'''
new = '''    if (isNew) {
      if (!Array.isArray(state.bills)) state.bills = [];
      const newBill = Object.assign({ id: uid("bill"), trackingStartIndex: todayIndex() }, patch);
      state.bills.push(newBill);'''
if old in s:
    s = s.replace(old,new,1)

# 8) Cleanup all one-payment overrides when a recurring bill is deleted.
marker = 'Object.keys(state.instanceStatusOverrides).forEach(k => { if (belongsToDeleted(k)) delete state.instanceStatusOverrides[k]; });'
if marker in s and 'state.instancePaymentMethodOverrides' not in s[s.find(marker):s.find(marker)+500]:
    s = s.replace(marker, marker + '\n    Object.keys(state.instancePaymentMethodOverrides).forEach(k => { if (belongsToDeleted(k)) delete state.instancePaymentMethodOverrides[k]; });\n    Object.keys(state.instanceTypeOverrides).forEach(k => { if (belongsToDeleted(k)) delete state.instanceTypeOverrides[k]; });',1)

p.write_text(s, encoding='utf-8')
