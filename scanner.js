/* Keep camera objects outside Alpine's reactive proxies. Serialize camera/file
 * operations so closing a modal or choosing a photo during startup is safe. */
function createLibraryScanner(readerId = 'universal-qr-reader') {
  let instance = null;
  let queue = Promise.resolve();
  let session = 0;
  let holdTimer = null, retained = false, deliver = () => {};

  function cancelHold() {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    retained = false;
  }

  function enqueue(work) {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }

  async function release() {
    if (!instance) return;
    if (instance.isScanning) await instance.stop();
    instance.clear();
    instance = null;
  }

  function create() {
    if (typeof Html5Qrcode === 'undefined') {
      throw new Error('Scanner could not load. Check your connection and reload this page.');
    }
    const formats = Html5QrcodeSupportedFormats;
    return new Html5Qrcode(readerId, {
      formatsToSupport: [formats.QR_CODE, formats.EAN_13, formats.EAN_8,
        formats.UPC_A, formats.UPC_E, formats.CODE_128, formats.CODE_39],
      verbose: false
    });
  }

  function cameraError(error) {
    const message = String(error && (error.name || error.message) || error);
    if (/NotAllowed|Permission|denied/i.test(message)) {
      return 'Camera access was denied. Allow camera access in your browser’s site settings, then try again. You can also scan a photo below.';
    }
    if (/NotFound|DevicesNotFound/i.test(message)) {
      return 'No camera was found. Connect a camera or scan a photo below.';
    }
    if (/NotReadable|TrackStart/i.test(message)) {
      return 'The camera is busy. Close other apps or tabs using it and try again.';
    }
    return 'Could not start the camera. Try again or scan a photo below.';
  }

  return {
    start(onDecoded, onStatus) {
      const current = ++session;
      const reuse = retained;
      cancelHold();
      return enqueue(async () => {
        if (current !== session) return;
        let accepted = false;
        deliver = text => {
          if (current !== session || accepted) return;
          accepted = true;
          onDecoded(text);
        };
        if (reuse && instance?.isScanning) {
          instance.resume();
          onStatus('Keep the entire barcode in view, including blank space at both ends. Hold steady in good light.');
          return;
        }
        await release();
        if (current !== session) return;
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera scanning needs HTTPS and a supported browser. Open the GitHub Pages site, or scan a photo below.');
        }
        instance = create();
        const success = text => deliver(text);
        // No qrbox: ISBN/EAN barcodes need their entire width and quiet margins.
        const config = { fps: 10, videoConstraints: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 }, height: { ideal: 720 }
        } };
        onStatus('Starting camera…');
        try {
          await instance.start({ facingMode: 'environment' }, config, success, () => {});
        } catch (error) {
          if (current !== session) return;
          // A desktop may only have a user-facing webcam. Never retry a denied permission.
          if (!/Overconstrained|ConstraintNotSatisfied|NotFound/i.test(String(error?.name || error))) throw error;
          await instance.start({ facingMode: 'user' }, { fps: 10 }, success, () => {});
        }
        if (current !== session) { await release(); return; }
        onStatus('Keep the entire barcode in view, including blank space at both ends. Hold steady in good light.');
      }).catch(async error => {
        if (current !== session) return;
        await enqueue(release);
        throw new Error(/HTTPS|could not load/.test(error.message || '') ? error.message : cameraError(error));
      });
    },

    scanFile(file) {
      cancelHold();
      const current = ++session;
      return enqueue(async () => {
        await release();
        if (current !== session) return null;
        instance = create();
        const text = await instance.scanFile(file, true);
        return current === session ? text : null;
      });
    },

    hold(duration) {
      cancelHold();
      if (!instance?.isScanning) return;
      instance.pause(false);
      retained = true;
      holdTimer = setTimeout(() => { this.stop().catch(() => {}); }, duration);
    },

    stop() {
      cancelHold();
      ++session;
      return enqueue(release);
    }
  };
}
