const hashString = (value: string) => {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return Math.abs(hash)
}

export const colorFromId = (id: string) => {
  const hue = hashString(id) % 360
  return `hsl(${hue} 80% 55%)`
}
