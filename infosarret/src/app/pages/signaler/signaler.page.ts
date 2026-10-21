import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonItem, IonLabel,
  IonSelect, IonSelectOption, IonInput, IonButton, IonIcon, ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { locateOutline, sendOutline } from 'ionicons/icons';
import { Geolocation } from '@capacitor/geolocation';
import { ArretService } from '../../services/arret.service';

@Component({
  selector: 'app-signaler',
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonItem, IonLabel,
    IonSelect, IonSelectOption, IonInput, IonButton, IonIcon,
  ],
  template: `
    <ion-header [translucent]="true">
      <ion-toolbar color="primary">
        <ion-title>Signaler un bus</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-item>
        <ion-label position="stacked">Ligne</ion-label>
        <ion-select [value]="numLigne" (ionChange)="chargerArrets($any($event).detail.value)"
                    placeholder="Choisir une ligne" interface="action-sheet" cancelText="Annuler">
          <ion-select-option *ngFor="let l of lignes" [value]="l.num_ligne">
            {{ l.nom_ligne || 'Ligne ' + l.num_ligne }}
          </ion-select-option>
        </ion-select>
      </ion-item>

      <ion-item>
        <ion-label position="stacked">Arrêt</ion-label>
        <ion-select [(ngModel)]="arretId" [disabled]="!numLigne"
                    placeholder="Où est le bus ?" interface="action-sheet" cancelText="Annuler">
          <ion-select-option *ngFor="let a of arrets" [value]="a.id">{{ a.nom }}</ion-select-option>
        </ion-select>
      </ion-item>

      <ion-button class="gps" fill="outline" size="small" [disabled]="!numLigne" (click)="utiliserMaPosition()">
        <ion-icon slot="start" name="locate-outline"></ion-icon>
        Arrêt le plus proche
      </ion-button>

      <ion-item>
        <ion-label position="stacked">Numéro du bus</ion-label>
        <ion-input [(ngModel)]="numBus" placeholder="Ex. 4821"></ion-input>
      </ion-item>

      <p class="titre">État du bus</p>
      <div class="etats">
        <ion-button *ngFor="let e of etats" [color]="e.couleur"
                    [fill]="etat === e.valeur ? 'solid' : 'outline'" (click)="etat = e.valeur">
          {{ e.libelle }}
        </ion-button>
      </div>

      <ion-button expand="block" size="large" [disabled]="!peutEnvoyer || envoi" (click)="envoyer()">
        <ion-icon slot="start" name="send-outline"></ion-icon>
        Envoyer le signalement
      </ion-button>
    </ion-content>
  `,
  styles: [`
    .gps { margin: 8px 0; }
    .titre { margin: 16px 4px 4px; font-weight: 600; color: var(--ion-color-medium); }
    .etats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0 16px; }
  `],
})
export class SignalerPage implements OnInit {
  lignes: any[] = [];
  arrets: any[] = [];
  numLigne: string | null = null;
  arretId: number | null = null;
  numBus = '';
  etat: string | null = null;
  latitude: number | null = null;
  longitude: number | null = null;
  envoi = false;

  etats = [
    { valeur: 'marche', libelle: 'En marche', couleur: 'success' },
    { valeur: 'arret', libelle: "À l'arrêt", couleur: 'warning' },
    { valeur: 'panne', libelle: 'En panne', couleur: 'danger' },
    { valeur: 'plein', libelle: 'Plein', couleur: 'tertiary' },
  ];

  constructor(
    private api: ArretService,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef
  ) {
    addIcons({ locateOutline, sendOutline });
  }

  ngOnInit() {
    this.api.getLignes().subscribe({
      next: (data) => {
        this.lignes = data;
        this.cdr.markForCheck();
      },
    });
  }

  get peutEnvoyer(): boolean {
    return !!this.numLigne && !!this.arretId && !!this.numBus.trim() && !!this.etat;
  }

  chargerArrets(num: string) {
    this.numLigne = num;
    this.arretId = null;
    this.arrets = [];
    if (!num) return;
    this.api.getCheminLigne(num).subscribe({
      next: (ligne) => {
        this.arrets = ligne.arrets;
        this.cdr.markForCheck();
      },
    });
  }

  async utiliserMaPosition() {
    try {
      const pos = await Geolocation.getCurrentPosition();
      this.latitude = pos.coords.latitude;
      this.longitude = pos.coords.longitude;
      const proche = this.api.arretLePlusProche(this.arrets, this.latitude, this.longitude);
      if (proche) {
        this.arretId = proche.arret.id;
        this.showToast(`Arrêt le plus proche : ${proche.arret.nom}`, 'success');
      }
      this.cdr.markForCheck();
    } catch (err) {
      console.error(err);
      this.showToast('Position indisponible', 'warning');
    }
  }

  envoyer() {
    if (!this.peutEnvoyer) return;
    this.envoi = true;
    this.api.envoyerSignalement({
      numLigne: this.numLigne!,
      arretId: this.arretId!,
      numBus: this.numBus.trim(),
      etat: this.etat!,
      latitude: this.latitude,
      longitude: this.longitude,
    }).subscribe({
      next: (res) => {
        this.showToast(res.cree ? 'Nouveau bus ajouté, merci !' : 'Position du bus mise à jour, merci !', 'success');
        this.arretId = null;
        this.numBus = '';
        this.etat = null;
        this.latitude = null;
        this.longitude = null;
        this.envoi = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error(err);
        this.showToast(err.error?.error || "Erreur lors de l'envoi", 'danger');
        this.envoi = false;
        this.cdr.markForCheck();
      },
    });
  }

  private async showToast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 2200, color, position: 'top' });
    await t.present();
  }
}