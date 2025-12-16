// Code snippet templates for workflow invocation
// Placeholders: {{URL}}, {{API_KEY}}, {{PAYLOAD}}, {{PAYLOAD_SINGLE_LINE}}, {{PAYLOAD_JSON}}

export const codeSnippets = {
  curl: `curl -X POST '{{URL}}' \\
  -H 'Authorization: Bearer {{API_KEY}}' \\
  -H 'Content-Type: application/json' \\
  -d '{{PAYLOAD_SINGLE_LINE}}'`,

  typescript: `async function invokeWorkflow() {
  const url = '{{URL}}';
  const apiKey = '{{API_KEY}}';
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${apiKey}\`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({{PAYLOAD}})
    });

    if (!response.ok) {
      throw new Error(\`HTTP error! status: \${response.status}\`);
    }

    const result = await response.json();
    console.log('Success:', result);
    return result;
  } catch (error) {
    console.error('Error invoking workflow:', error);
    throw error;
  }
}

// Call the function
invokeWorkflow();`,

  python: `import requests
import json

url = '{{URL}}'
api_key = '{{API_KEY}}'

headers = {
    'Authorization': f'Bearer {api_key}',
    'Content-Type': 'application/json'
}

# Payload as Python dict (parsed from JSON)
payload = json.loads('{{PAYLOAD_JSON}}')

try:
    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()  # Raises an HTTPError for bad responses
    result = response.json()
    print('Success:', json.dumps(result, indent=2))
except requests.exceptions.RequestException as e:
    print(f'Error invoking workflow: {e}')
    raise`,

  go: `package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
)

func main() {
    url := "{{URL}}"
    apiKey := "{{API_KEY}}"
    
    payload := map[string]interface{}{
        {{GO_PAYLOAD}}
    }
    
    jsonData, err := json.Marshal(payload)
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error marshaling payload: %v\\n", err)
        os.Exit(1)
    }

    req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error creating request: %v\\n", err)
        os.Exit(1)
    }

    req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    res, err := client.Do(req)
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error making request: %v\\n", err)
        os.Exit(1)
    }
    defer res.Body.Close()

    body, err := io.ReadAll(res.Body)
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error reading response: %v\\n", err)
        os.Exit(1)
    }

    if res.StatusCode >= 200 && res.StatusCode < 300 {
        fmt.Println("Success:", string(body))
    } else {
        fmt.Fprintf(os.Stderr, "Error: HTTP %d - %s\\n", res.StatusCode, string(body))
        os.Exit(1)
    }
}`,
};

