export type UserRole = 'user' | 'moderator' | 'admin' | 'developer';

export interface Profile {
  id: string;
  username: string;          // без @, отображать как @username в UI
  display_name: string;
  avatar_url: string | null;
  role: UserRole;
  is_verified: boolean;
  verified_at: string | null;
  last_seen: string | null;
  created_at: string;
}

export type ChatType = 'direct' | 'group' | 'channel';
export type ChatVisibility = 'public' | 'private';

export interface Chat {
  id: string;
  type: ChatType;
  visibility: ChatVisibility | null;
  username: string | null;
  title: string | null;
  description: string | null;
  avatar_url: string | null;
  is_verified: boolean;
  created_by: string | null;
  created_at: string;
}
