/** Additive output from Langflow. All quantities are calculated by the execution engine. */
export type SpherePlanning = {
 schema_version:'sphere2018-population-v1';
 complete_age_counts:boolean;
 nutrition:{energy_kcal:number|null;protein_g:number|null;fat_g:number|null;carbohydrate_equivalent_g:number|null};
 age_groups:{key:'under5'|'children'|'adults'|'elderly';people:number|null;water_l:number|null;energy_kcal:number|null}[];
 issues:string[];
};
export const sphereReference='https://spherestandards.org/wp-content/uploads/Sphere-Handbook-2018-EN.pdf';
