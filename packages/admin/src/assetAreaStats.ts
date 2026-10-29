type AreaHouse = { id: string; area: number; status: string }

/** 可出租条件独立于上架；在租面积不因展示下架而消失。 */
export function calculateAssetAreaStats(houses: AreaHouse[], isRentable: (house: AreaHouse) => boolean) {
  const areaOf = (house: AreaHouse) => Number.isFinite(house.area) ? Math.max(0, house.area) : 0
  const totalArea = houses.reduce((total, house) => total + areaOf(house), 0)
  const rentableArea = houses.filter(isRentable).reduce((total, house) => total + areaOf(house), 0)
  const rentedArea = houses.filter((house) => house.status === 'SIGNED').reduce((total, house) => total + areaOf(house), 0)
  return { totalArea, rentableArea, rentedArea, occupancyRate: rentableArea > 0 ? rentedArea / rentableArea : 0 }
}
