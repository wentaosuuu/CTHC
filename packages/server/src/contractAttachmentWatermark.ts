import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import sharp from 'sharp'

/** 已盖章、待租客完成首笔缴费（与后台「待支付」一致） */
export function contractAttachmentLockedUntilTenantPaid(status: string): boolean {
  return status === 'PENDING_PAYMENT'
}

/** 栅格图（SVG）可用系统字体渲染中文 */
const WM_LINE1 = '预览稿 · 待租客缴费'
const WM_LINE2 = '缴费后可下载正式版'
/** PDF 标准字体不含中文，使用拉丁字符水印 */
const WM_PDF_1 = 'PREVIEW — PAYMENT PENDING'
const WM_PDF_2 = 'Full file after tenant pays'

function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function applyContractPreviewWatermark(
  fileBuffer: Buffer,
  extWithDot: string,
): Promise<Buffer> {
  const ext = extWithDot.toLowerCase()
  try {
    if (ext === '.pdf') return await watermarkPdf(fileBuffer)
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return await watermarkRaster(fileBuffer, ext)
  } catch (e) {
    console.warn('[contractAttachmentWatermark] failed, serving original:', e)
  }
  return fileBuffer
}

async function watermarkPdf(buf: Buffer): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true })
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const stepX = 220
  const stepY = 150
  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize()
    for (let y = -height * 0.2; y < height * 1.2; y += stepY) {
      for (let x = -width * 0.2; x < width * 1.2; x += stepX) {
        page.drawText(WM_PDF_1, {
          x,
          y,
          size: 15,
          font,
          color: rgb(0.5, 0.5, 0.5),
          opacity: 0.1,
          rotate: degrees(-30),
        })
      }
    }
    page.drawText(WM_PDF_2, {
      x: width * 0.18,
      y: height * 0.52,
      size: 13,
      font,
      color: rgb(0.35, 0.35, 0.35),
      opacity: 0.18,
      rotate: degrees(-28),
    })
  }
  return Buffer.from(await pdfDoc.save())
}

async function watermarkRaster(buf: Buffer, ext: string): Promise<Buffer> {
  const img = sharp(buf, { failOn: 'none' })
  const meta = await img.metadata()
  const w = meta.width ?? 1200
  const h = meta.height ?? 900
  const fs = Math.max(18, Math.floor(Math.min(w, h) * 0.04))
  const t1 = escapeXml(WM_LINE1)
  const t2 = escapeXml(WM_LINE2)
  const cx = w / 2
  const cy = h * 0.5
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif"
        font-size="${fs}" fill="rgba(25,25,25,0.24)" font-weight="800"
        transform="rotate(-26 ${cx} ${cy})">${t1}</text>
      <text x="${cx}" y="${cy + fs * 1.15}" text-anchor="middle"
        font-family="system-ui,-apple-system,'PingFang SC',sans-serif"
        font-size="${Math.floor(fs * 0.72)}" fill="rgba(25,25,25,0.18)" font-weight="600"
        transform="rotate(-26 ${cx} ${cy + fs * 1.15})">${t2}</text>
    </svg>`,
    'utf-8',
  )
  const composed = img.composite([{ input: svg, blend: 'over' }])
  if (meta.format === 'jpeg' || ext === '.jpg' || ext === '.jpeg') return composed.jpeg({ quality: 88 }).toBuffer()
  if (meta.format === 'png') return composed.png({ compressionLevel: 8 }).toBuffer()
  if (meta.format === 'webp') return composed.webp({ quality: 88 }).toBuffer()
  if (meta.format === 'gif') return composed.gif().toBuffer()
  return composed.toBuffer()
}
