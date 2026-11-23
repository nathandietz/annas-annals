# TODO

- [ ] Keep Google Sheets connected across visits. Keep the frontend on GitHub Pages and add a small OAuth backend, with Cloudflare Workers as a hosting option. Use Google’s authorization code flow and store refresh tokens securely on the backend. When users reopen Anna’s Annals, renew Google access automatically and reopen their saved Sheet. Prompt them to reconnect if Google authorization expires or is revoked. Set the Google OAuth app to **In production** to avoid the seven-day Testing limit for newly issued refresh tokens.
