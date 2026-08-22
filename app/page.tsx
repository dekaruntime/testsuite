import { loadBuildResults } from '@/lib/build-tests'
import { HatsGrid } from '@/components/HatsGrid'

export default async function HomePage() {
  const { nativeAvailable, browserAvailable, version, categories } = await loadBuildResults()
  return (
    <HatsGrid
      categories={categories}
      nativeAvailable={nativeAvailable}
      browserAvailable={browserAvailable}
      version={version}
    />
  )
}
