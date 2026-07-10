export interface RawPost {
  id: string;
  platform: 'reddit' | 'twitter' | 'threads';
  title?: string;
  body: string;
  author: string;
  url: string;
  subreddit?: string;
  createdAt: string;
}

export interface LeadAnalysis {
  relevanceScore: number; // 1-10
  reason: string; // one sentence why this score was given
  whatTheyNeed: string;
  budget: string | null;
  urgency: string | null;
  contactHint: string | null;
  isHiringPost: boolean;
  isWebDesign: boolean; // web design leads get a special tag (friend collab)
}

export interface FilteredLead {
  post: RawPost;
  analysis: LeadAnalysis;
}
