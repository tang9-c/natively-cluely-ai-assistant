export enum DocType {
  RESUME = 'resume',
  JD = 'job_description',
}

export interface ResumeIdentity {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
}

export interface ResumeExperience {
  title: string;
  organization: string;
  start?: string;
  end?: string;
  description?: string;
}

export interface ResumeProject {
  name: string;
  description?: string;
}

export interface ResumeEducation {
  degree?: string;
  institution?: string;
  year?: string;
}

export interface ResumeParsed {
  identity: ResumeIdentity;
  summary?: string;
  skills: string[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  education: ResumeEducation[];
}

export interface JDParsed {
  title: string;
  company?: string;
  level?: string;
  location?: string;
  technologies: string[];
  requirements: string[];
  keywords: string[];
  responsibilities: string[];
  compensation_hint?: string;
  min_years_experience?: number;
}

export interface ResumeNode {
  id?: number;
  category: 'experience' | 'project' | 'education';
  title?: string;
  organization?: string;
  startDate?: string;
  endDate?: string;
  durationMonths?: number;
  textContent?: string;
  tags?: string;
}

export interface ProfileData {
  identity: { name: string; email?: string };
  experienceCount: number;
  projectCount: number;
  nodeCount: number;
  skills: string[];
  hasActiveJD: boolean;
  activeJD?: {
    title: string;
    company?: string;
    level?: string;
    technologies: string[];
    location?: string;
    keywords?: string[];
    requirements?: string[];
    compensation_hint?: string;
    min_years_experience?: number;
  };
}

export interface UserProfileRecord {
  id: number;
  structured_json: string;
  compact_persona?: string;
  created_at: number;
}
