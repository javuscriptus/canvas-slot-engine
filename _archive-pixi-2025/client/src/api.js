export class APIClient {
  constructor() {
    const params = new URLSearchParams(window.location.search);
    const queryApiUrl = params.get("api_url");
    this.baseUrl = queryApiUrl || window.location.origin;
    this.token = params.get("token") || "demo_token";
  }

  async init() {
    const response = await fetch(`${this.baseUrl}/api/init`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ token: this.token })
    });

    if (!response.ok) {
      throw new Error("Initialization failed");
    }

    return response.json();
  }

  async spin(bet) {
    const response = await fetch(`${this.baseUrl}/api/spin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ token: this.token, bet })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Spin failed");
    }

    return response.json();
  }
}
