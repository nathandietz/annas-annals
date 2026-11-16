# Scanner dependency

`html5-qrcode-2.3.8.min.js` is the Apache-2.0 licensed html5-qrcode 2.3.8 distribution from npm. It has two local changes to its ZXing decoder: enable TRY_HARDER and, if the full scan fails, retry five overlapping horizontal crops. These help with ISBN barcodes next to price add-ons. See `html5-qrcode-LICENSE.txt`. Reapply and retest these changes when updating the dependency.
