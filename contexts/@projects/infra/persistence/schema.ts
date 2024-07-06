export interface Projects {
  id: string;
  title: string;
}

export interface Tasks {
  completed: number;
  description: string;
  id: string;
  projectId: string;
}

export interface DB {
  projects: Projects;
  tasks: Tasks;
}
