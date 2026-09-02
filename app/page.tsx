import { loadBuildResults } from '@/lib/build-tests'
import { HatsGrid } from '@/components/HatsGrid'

export default async function HomePage() {
  const { nativeAvailable, browserAvailable, version, groups, categories } = await loadBuildResults()
  return (
    <HatsGrid
      categories={categories}
      groups={groups}
      nativeAvailable={nativeAvailable}
      browserAvailable={browserAvailable}
      version={version}
    />
  )
}
