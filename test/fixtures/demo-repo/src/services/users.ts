// demo lib for smoke tests
export class UserService {
  constructor(private api: ApiClient) {}
  async getUser(id: string) {
    return this.api.get(`/users/${id}`);
  }
  async getUsers() {
    return this.api.get("/users");
  }
}

export class ApiClient {
  get(url: string) {
    return fetch(url);
  }
}

export function useUsers() {
  return new ApiClient().get("/users");
}
