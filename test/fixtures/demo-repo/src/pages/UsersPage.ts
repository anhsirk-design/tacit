import { useUsers } from "./services/users.js";

export function UsersPage() {
  const users = useUsers();
  return { users };
}
