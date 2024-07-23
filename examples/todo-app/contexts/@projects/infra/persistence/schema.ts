export interface Events {
  delivered: number;
  id: string;
  occurredOn: string;
  payload: string;
}

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
  events: Events;
  projects: Projects;
  tasks: Tasks;
}
