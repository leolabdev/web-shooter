const hashString = (value: string) => {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return Math.abs(hash)
}

export const colorFromId = (id: string) => {
  const hash = hashString(id)
  const hue = hash % 360
  const saturation = 68 + ((hash >> 8) % 22)
  const lightness = 46 + ((hash >> 16) % 12)
  return `hsl(${hue} ${saturation}% ${lightness}%)`
}
