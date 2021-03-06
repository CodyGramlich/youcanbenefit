
import { throwError as observableThrowError, Observable , ReplaySubject, of } from 'rxjs';
import { map, flatMap, take, zip, catchError, tap, refCount, multicast } from 'rxjs/operators'
import { Injectable } from '@angular/core';
import { Http, RequestOptions} from '@angular/http';
import { ApplicationFacingProgram, ProgramQuery, Question} from '../../models'
import { UserFacingProgram } from '../../../shared/models'
import { AuthService } from '../../core/services/auth.service'
import { Program } from './program.class';
import { FormBuilder } from '@angular/forms';
import { environment } from '../../../../environments/environment'
import { ProgramQueryClass } from './program-query.class';
import { BrowseService } from 'src/app/user/browse/browse.service';

@Injectable()
export class ProgramModelService {
    private _cache: Observable<ApplicationFacingProgram[]>;
    questions: Observable<Question[]>;
    constructor(
        private http: Http,
        private authService: AuthService,
        private fb: FormBuilder,
        private browseService: BrowseService
    ) {
        const withSharing = obs => typeof obs === "function" && (
            obs().pipe(
                take(1),
                multicast(new ReplaySubject),
                refCount()
            )
        )

        this.questions = withSharing(this._getQuestions)
        this._cache = withSharing(this._loadPrograms)
    }

    private _findProgram(guid: string) {
        return p => p.guid === guid;
    }

    findProgram(guid: string): Observable<Program> {
        return this._cache
            .pipe(map(programs => {
                const program = programs.find(this._findProgram(guid))
                return program ? new Program(program, this.fb) : new Program(undefined, this.fb)
            }))
    }

    getPrograms(): Observable<ApplicationFacingProgram[]> {
        if (this._cache) {
            this._cache.subscribe();
            return this._cache
        } 
    }

    private _updateUserProgramInCache(program: UserFacingProgram) {
        this._cache.pipe(take(1))
                .subscribe(cache => {
                    const val = cache.find(p => p.guid === program.guid);
                    if (val) {
                        val.user = program;
                    } else {
                        cache.push({guid: program.guid, application: [], user: program})
                    }
            })
    }

    saveUserProgram(program: UserFacingProgram){
        const creds = this.getCredentials();
        creds.headers.append('Content-Type', 'application/json' );

        return this._saveProgram(program)
            .pipe(tap(res => {
                if (res.result === 'updated' || res.result === 'created') {
                    this._updateUserProgramInCache(program);
                    this.browseService.updateProgramInCache(program);
                }
            }))
    }

    deleteProgram(guid: string): Observable<boolean> {
        return this._deleteProgram(guid)
            .pipe(tap(res => {
                if (res) {
                    this._cache.subscribe(cache => {
                        const index = cache.findIndex(p => p.user.guid === guid)
                        cache.splice(index, 1);
                    })
                    this.browseService.deleteProgramInCache(guid);
                }
            }))
    }

    getAllTags(): string[] {
        let tags: string[] = []
        this._cache.subscribe(cache => {
            cache.forEach(program => {
                program.user.tags.forEach(tag => {
                    if (!tags.includes(tag)) {
                        tags.push(tag)
                    }
                })
            })
        })
        tags.sort();
        return tags;
    }

    updateCachedQuery(updatedQuery: ProgramQueryClass) {
        updatedQuery.form.value.conditions.forEach(condition => delete condition['type']);
        this._cache.pipe(take(1))
            .subscribe(cache => {
                let program = cache.find(p => p.guid === updatedQuery.data.guid);
                const index = program.application.findIndex(q => q.id === updatedQuery.data.id);
                if (index >= 0) {
                    program.application[index] = updatedQuery.form.value;
                } else {
                    program.application.push(updatedQuery.form.value);
                }
        })
    }

    removeCachedQuery(program_guid: string, query_id: string) {
        this._cache.pipe(take(1))
            .subscribe(cache => {
                let program = cache.find(p => p.guid === program_guid);
                const index = program.application.findIndex(q => q.id === query_id);
                if (index >= 0) {
                    program.application.splice(index, 1);
                }
        })
    }

    private getCredentials(): RequestOptions {
        try {
            return this.authService.getCredentials();
        } catch(e) {
            console.log("************************")
            console.error(e)
            console.log("************************")
            return this.authService.getCredentials();
        }
        
    }

    private _loadPrograms = () => {
        const creds = this.getCredentials();
        return this.http.get(`${environment.api}/protected/program/`, creds)
            .pipe(map( res => res.json()), catchError(this.loadError))
    }

    private _saveProgram(program: UserFacingProgram){
        const creds = this.getCredentials();
        creds.headers.append('Content-Type', 'application/json' );
        return this.http.put(`${environment.api}/protected/program-description/`, program, creds)
            .pipe(
                map(res => res.json()),
                catchError(this.loadError)
            )
    }

    private _deleteProgram(guid: string) {
        const creds = this.getCredentials();
        return this.http.delete(`${environment.api}/protected/program/${guid}`, creds)
            .pipe(
                map(res => res.json()),
                map(res => res.deleted),
                catchError(this.loadError)
            )
    }

    private _getQuestions = () => {
        const creds = this.getCredentials();
        return this.http.get(`${environment.api}/protected/question/`, creds)
            .pipe(map( res => res.json()), catchError(this.loadError))
    }

    loadError(error: Response | any) {
        let errMsg: string;
        if (error instanceof Response) {
            const body = error.json() || '';
            errMsg = body['message'] || JSON.stringify(body);
        } else {
            errMsg = error.message ? error.message : error.toString();
        }
        return observableThrowError(errMsg);
    }

    getBlankQuery(guid: string): ProgramQuery {
        return {
            id: this.generateRandomString(),
            guid,
            conditions: []
        };
    }

    generateRandomString(): string {
        const LENGTH = 26;
        const lowerCaseCharSet = "abcdefghijklmnopqrstuvwxyz";
        const charSet = lowerCaseCharSet
            .concat(lowerCaseCharSet.toUpperCase())
            .concat("1234567890");

        const generateCharacters = () => {
            const arr = new Array(LENGTH);
            for(let i = 0; i < arr.length; i++){
                arr[i] = charSet[Math.floor(Math.random() * charSet.length)];
            }
            return arr;
        };

        return generateCharacters().join('');
    }
}
