import type { ReactNode } from 'react';
import './course-creator.css';
export default function CourseCreatorLayout({children}: {children: ReactNode}) {
 return <div className="course-creator-shell">{children}</div>;
}
