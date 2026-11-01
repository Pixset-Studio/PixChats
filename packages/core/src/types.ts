export type UserRole = 'user' | 'moderator' | 'admin' | 'developer' | 'partner';

export interface Profile {
  id: string;
  username: string;          // без @, отображать как @username в UI
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  role: UserRole;
  is_verified: boolean;
  is_pixset_employee: boolean;
  verified_at: string | null;
  last_seen: string | null;
  created_at: string;
  public_identity_key: string | null;
  theme: 'pixchats' | 'industrial' | 'arcade' | 'minimal' | 'byteblaster' | 'byte_blaster' | 'dark' | 'light';
  privacy_who_can_message: 'everyone' | 'friends_only' | 'nobody';
  privacy_show_last_seen: 'everyone' | 'friends_only' | 'nobody';
  privacy_who_can_add_to_groups: 'everyone' | 'friends_only' | 'nobody';
  banned_until: string | null;
  banned_permanently: boolean;
  frozen: boolean;
  frozen_at?: string | null;
  last_ip?: string | null;
}

export interface ChatMute {
  id: string;
  user_id: string;
  chat_id: string;
  muted_until: string | null;
  reason: string | null;
  muted_by: string | null;
  created_at: string;
  chat_title?: string;
  user_name?: string;
  user_username?: string;
}

export interface BannedIp {
  id: string;
  ip_address: string;
  reason: string | null;
  banned_by: string | null;
  created_at: string;
}

export type AppealPenaltyType = 'mute' | 'freeze' | 'ban_account' | 'ban_ip';
export type AppealStatus = 'pending' | 'approved' | 'rejected';

export interface AppealItem {
  id: string;
  user_id: string;
  penalty_type: AppealPenaltyType;
  chat_id: string | null;
  reason: string;
  status: AppealStatus;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  user_name?: string;
  user_username?: string;
  user_avatar?: string | null;
  chat_title?: string;
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
  direct_pair_key: string | null;
}
