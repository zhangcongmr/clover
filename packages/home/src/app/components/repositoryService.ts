import { NodeDef } from "@julyware/common";

/**
 * Fetches repositories for a given user
 * @param userName - The username to fetch repositories for
 * @returns Promise resolving to an array of NodeDef (repositories)
 */
export async function fetchUserRepositories(userName: string): Promise<NodeDef[]> {
  const queryUserName = userName || '';
  const response = await fetch(`/user/briefsByUserName?userName=${encodeURIComponent(queryUserName)}`);
  
  // Check if response is JSON
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error('API endpoint not available');
  }
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data: Array<NodeDef> = await response.json();
  return data;
}
