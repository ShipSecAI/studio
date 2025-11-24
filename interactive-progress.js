#!/usr/bin/env node

const readline = require('readline');

// Interactive progress bar with carriage returns
function showInteractiveProgress() {
  const steps = 10;
  const barWidth = 30;
  let current = 0;

  // Create readline interface for terminal control
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('🚀 Starting interactive terminal demo...');
  console.log('📊 Watch the progress bar update in real-time!');
  console.log('');

  const interval = setInterval(() => {
    if (current <= steps) {
      const progress = current;
      const filled = Math.floor((progress / steps) * barWidth);
      const empty = barWidth - filled;

      // Create progress bar
      const bar = '█'.repeat(filled) + '░'.repeat(empty);
      const percentage = Math.floor((progress / steps) * 100);

      // Use carriage return to rewrite the same line
      process.stdout.write('\r[' + progress.toString().padStart(2) + '/' + steps + '] [' + bar + '] ' + percentage.toString().padStart(3) + '% ' + getSpinner());

      if (current < steps) {
        current++;
      } else {
        clearInterval(interval);
        console.log('\n✅ Interactive demo completed successfully!');
        console.log('🎯 This demonstrates:');
        console.log('   • Real-time progress updates');
        console.log('   • Carriage return for line rewriting');
        console.log('   • PTY terminal capabilities');
        console.log('');

        // Output JSON for component result
        const result = {
          message: "Interactive terminal demo",
          stepsCompleted: steps,
          interactive: true,
          rawOutput: `Demo completed with ${steps} interactive steps using carriage returns`
        };
        console.log(JSON.stringify(result));

        rl.close();
      }
    }
  }, 300);

  function getSpinner() {
    const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return spinners[Math.floor(Date.now() / 100) % spinners.length];
  }
}

// Simulate some work before showing progress
console.log('🔧 Initializing interactive demo...');
setTimeout(() => {
  showInteractiveProgress();
}, 1000);