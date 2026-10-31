import {useRef,useState} from 'react';
import type {Shelter} from './demo';
import type {PendingReview} from './pendingReviews';
/** One authoritative workspace projection; navigation never owns or copies candidate records. */
export function useReviewWorkspace(){
 const [activeRows,setActiveRows]=useState<Shelter[]>([]);
 const [pendingReviews,setPendingReviews]=useState<PendingReview[]>([]);
 const pendingReviewRef=useRef<PendingReview[]>([]),storedBase=useRef<Shelter[]>([]),rowsRef=useRef<Shelter[]>([]);
 rowsRef.current=activeRows;
 return {activeRows,setActiveRows,pendingReviews,setPendingReviews,pendingReviewRef,storedBase,rowsRef};
}
