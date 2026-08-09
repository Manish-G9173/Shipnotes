const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config.js', (req, res) => {
  // Exposes the api service's public URL to the browser.
  // Set API_PUBLIC_URL in the frontend service's env vars once the
  // api service has a public domain (Zerops assigns one automatically).
  const apiUrl = process.env.API_PUBLIC_URL || '';
  res.type('application/javascript').send(`window.API_URL = ${JSON.stringify(apiUrl)};`);
});

app.listen(PORT, () => console.log(`frontend listening on ${PORT}`));
