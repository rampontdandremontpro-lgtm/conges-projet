import { DirectorStatisticsPage } from '@/pages/director/StatisticsPage'
import { getRhStatistics, getRhStatisticsServices } from '@/services/rh/rhStatistics'

export function RhStatisticsPage() {
  return (
    <DirectorStatisticsPage
      getStatistics={getRhStatistics}
      getStatisticsServices={getRhStatisticsServices}
    />
  )
}
