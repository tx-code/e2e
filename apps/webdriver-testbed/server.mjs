import http from 'node:http';

const html = `<!doctype html><html lang="en"><title>WebDriver testbed</title>
<main><h1>Form controls</h1>
<label for="display-name">Display name</label><input id="display-name" data-testid="display-name">
<label for="choice">Choice</label><select id="choice"><option value="">None</option><option value="blue">Blue</option><option value="green">Green</option></select>
<label><input id="enabled" type="checkbox">Feature enabled</label>
<button id="apply">Apply</button><button id="double">Double click</button><button id="replace">Replace field</button>
<p role="status" aria-label="Result" id="result">Nothing applied</p>
<p role="status" aria-label="Double count" id="double-count">0</p>
</main><script>
document.getElementById('apply').onclick = () => {
document.getElementById('result').textContent = [document.getElementById('display-name').value,document.getElementById('choice').value,document.getElementById('enabled').checked].join('|');
};
document.getElementById('double').ondblclick = () => { const n=document.getElementById('double-count');n.textContent=String(Number(n.textContent)+1); };
document.getElementById('replace').onclick = () => { const n=document.getElementById('display-name');n.replaceWith(n.cloneNode(true)); };
</script></html>`;

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  const page = process.env.CHANGED_CONTROL === '1' ? html
    .replaceAll('id="apply"', 'id="commit"')
    .replaceAll("getElementById('apply')", "getElementById('commit')")
    .replace('>Apply</button>', '>Commit changes</button>') : html;
  response.end(page);
});
server.listen(Number(process.env.PORT ?? 4387), '127.0.0.1');
