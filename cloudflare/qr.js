import QRCode from 'qrcode';
export async function renderQr(url) {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 3,
    width: 760,
    color: {dark: '#142e4b', light: '#ffffff'}
  });
}
