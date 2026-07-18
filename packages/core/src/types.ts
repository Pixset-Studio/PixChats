export type UserRole = 'user' | 'moderator' | 'admin' | 'developer' | 'partner';

export interface Profile {
  id: string;
  username: string;          // без @, отображать как @username в UI
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  role: UserRole;
  is_verified: boolean;
  verified_at: string | null;
  last_seen: string | null;
  created_at: string;
  public_identity_key: string | null;
  theme: 'dark' | 'light';
  privacy_who_can_message: 'everyone' | 'friends_only';
  privacy_show_last_seen: 'everyone' | 'friends_only' | 'nobody';
}

export type FriendshipStatus = 'pending' | 'accepted';

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  responded_at: string | null;
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
  pinned_message_id: string | null;
}
