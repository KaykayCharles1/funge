import qrcode from "qrcode-generator";

// The WizardConnect "qrUri" is built to be alphanumeric-safe; fall back to byte mode if not
export function qrDataUrl(text: string): string {
  const build = (mode?: "Alphanumeric") => {
    const qr = qrcode(0, "L");
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