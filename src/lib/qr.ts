import qrcode from "qrcode-generator";

// The WizardConnect "qrUri" is built to be alphanumeric-safe; fall back to byte mode if not.
// Error correction "Q" (a quarter of the code can be covered and it still scans): the battlefield lays the
// WizardConnect logo over the middle.
export function qrDataUrl(text: string): string {
  const build = (mode?: "Alphanumeric") => {
    const qr = qrcode(0, "Q");
    if (mode) qr.addData(text, mode);
    else qr.addData(text);
    qr.make();
    return qr;
  };
  let qr;
  try {
    qr = build("Alphanumeric");
  } catch {
    qr = build();
  }
  return qr.createDataURL(6, 2);
}