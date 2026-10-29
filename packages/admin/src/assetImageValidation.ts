type UploadImage = { name: string; type: string; size: number }
export const MAX_ASSET_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_ASSET_IMAGES = 10

export function assetImageUploadError(files: UploadImage[], currentCount: number): string {
  if (currentCount + files.length > MAX_ASSET_IMAGES) return '房源图片最多10张，请先删除部分图片后再上传。'
  for (const file of files) {
    if (!/\.(png|jpe?g)$/i.test(file.name) || !['image/png', 'image/jpeg'].includes(file.type)) {
      return `${file.name}：仅支持png、jpg、jpeg格式的图片。`
    }
    if (file.size <= 0) return `${file.name}：图片为空，请重新选择。`
    if (file.size > MAX_ASSET_IMAGE_BYTES) return `${file.name}：图片不能超过5MB。`
  }
  return ''
}
