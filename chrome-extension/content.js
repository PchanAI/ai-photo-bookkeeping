// Wait for DOM elements to load and populate them
function autoFill() {
  const params = new URLSearchParams(window.location.search);
  const invoiceNumber = params.get('invoiceNumber');
  const invoiceDate = params.get('invoiceDate');
  const randomNumber = params.get('randomNumber');

  console.log('[E-Invoice Auto-fill Helper] URL parameters:', { invoiceNumber, invoiceDate, randomNumber });

  if (invoiceNumber) {
    const invInput = document.getElementById('invoiceNumber');
    if (invInput) {
      invInput.value = invoiceNumber.replace(/-/g, '');
      invInput.dispatchEvent(new Event('input', { bubbles: true }));
      invInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  if (invoiceDate) {
    const dateInput = document.getElementById('dp-input-invoiceDate');
    if (dateInput) {
      dateInput.value = invoiceDate;
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  if (randomNumber) {
    const rndInput = document.getElementById('randomnumber');
    if (rndInput) {
      rndInput.value = randomNumber;
      rndInput.dispatchEvent(new Event('input', { bubbles: true }));
      rndInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

// Since the page might render dynamically or use Vue, retry a few times if inputs are not found
let retryCount = 0;
const fillInterval = setInterval(() => {
  const invInput = document.getElementById('invoiceNumber');
  const dateInput = document.getElementById('dp-input-invoiceDate');
  const rndInput = document.getElementById('randomnumber');

  if (invInput || dateInput || rndInput || retryCount > 15) {
    clearInterval(fillInterval);
    autoFill();
  }
  retryCount++;
}, 300);
