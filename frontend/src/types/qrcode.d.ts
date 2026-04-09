declare module 'qrcode' {
  export interface QRCodeToDataURLOptions {
    margin?: number;
    width?: number;
  }

  interface QRCodeModule {
    toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  }

  const QRCode: QRCodeModule;

  export default QRCode;
}
