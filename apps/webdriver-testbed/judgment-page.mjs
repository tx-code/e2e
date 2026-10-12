/** Neutral, controlled observations; no expected verdict is supplied to the model. */
export function judgmentPage(delayed) {
  return `<!doctype html><html lang="en"><title>WebDriver testbed</title>
<main><h1>Inventory review</h1>
<p>Material: Aluminium</p><p>Quantity: 7</p>
<p>Previous operation, revision 1: Completed successfully</p>
<p role="status" aria-label="Current operation">Current operation, revision 2: Running</p>
<p role="status" aria-label="Readiness">${delayed ? 'Pending' : 'Not ready'}</p>
</main>${delayed ? '<script>setTimeout(() => { document.querySelector(\'[aria-label="Readiness"]\').textContent="Ready"; }, 6000)</script>' : ''}</html>`;
}
