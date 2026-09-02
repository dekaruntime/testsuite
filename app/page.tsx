import { loadBuildResults } from '@/lib/build-tests'
import { HatsGrid } from '@/components/HatsGrid'

export default async function HomePage() {
  const { nativeAvailable, browserAvailable, version, groups, latestVersion, categories } = await loadBuildResults()
  return (
    <HatsGrid
      categories={categories}
      groups={groups}
      latestVersion={latestVersion}
      nativeAvailable={nativeAvailable}
      browserAvailable={browserAvailable}
      version={version}
    />
  )
}
