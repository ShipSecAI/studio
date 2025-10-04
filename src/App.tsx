import { Button } from '@/components/ui/button'

function App() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <h1 className="text-3xl font-bold text-center mb-4">
          Security Workflow Builder
        </h1>
        <p className="text-center text-muted-foreground mb-8">
          Open-source security automation for engineers and bug bounty hunters
        </p>
        <div className="flex justify-center gap-4">
          <Button>Get Started</Button>
          <Button variant="outline">Learn More</Button>
        </div>
      </div>
    </div>
  )
}

export default App