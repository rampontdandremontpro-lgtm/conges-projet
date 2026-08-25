import { DirectorStatisticsPage } from '@/pages/director/StatisticsPage'
import { getRhStatistics, getRhStatisticsLeaveTypes, getRhStatisticsServices } from '@/services/rh/rhStatistics'

export function RhStatisticsPage() {
  return (
    <DirectorStatisticsPage
      getStatistics={getRhStatistics}
      getStatisticsServices={getRhStatisticsServices}
      getStatisticsLeaveTypes={getRhStatisticsLeaveTypes}
    />
  )
}
